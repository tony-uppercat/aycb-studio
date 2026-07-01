import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { useSettings } from '../../components/SettingsContext'
import { api } from '../../api'
import type { GenerateImageNodeData } from '../../types'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { loadMedia, generateMediaId } from '../../mediaStore'
import { pullText, pullAllMedia, resolveSourceText } from '../../hooks/useDataPropagation'
import { useGenerateImageHistory } from '../../hooks/useGenerateImageHistory'
import { useStateRef } from '../../hooks/useStateRef'
import { useModelRegistry, type RegistryModel } from '../../hooks/useModelRegistry'
import { reportNodeError } from '../../utils/nodeErrors'
import { useCanvasStore } from '../../stores/canvasStore'
import { estimateCost, formatCostEstimate } from '../../utils/costEstimate'
import { fetchReviewStatus, toggleFavorite, type ReviewStatus } from '../../utils/reviewStatus'
import { cropImageFileToAspectRatio } from '../../utils/cropToAspectRatio'
import { geminiSupportsBatch } from '../../providers/geminiBatchPath'
import { buildGeminiImageBody, resolveModel } from '../../providers/geminiProvider'
import { computeSize, resolutionToQuality } from '../../providers/openaiProvider'
import { enqueueAsyncRequest } from '../../services/asyncBundler'
import { useAsyncJobStore, selectJobForNode } from '../../stores/asyncJobStore'
import { applyImageResult } from '../../services/applyImageResult'
import { isChainRunning } from '../../utils/cascadeRun'

export type RunPlan = 'async' | 'sync' | 'skip'

/**
 * Decide how a single generation should run.
 *
 * - 'async' — submit to the Batch API queue (−50%, non-blocking).
 * - 'sync'  — run inline via api.generateImage.
 * - 'skip'  — do nothing (an async batch for this node is already in flight).
 *
 * Async is allowed ONLY for a standalone, single (×1) run:
 *  - `inChain` (executeCascade / executeCascadesParallel): a batched result
 *    lands minutes/hours later and downstream nodes would consume stale/empty
 *    input → force sync. (C1)
 *  - `batchCount > 1`: the bundler dedups by nodeId and the consumer renders a
 *    single mediaId, so N async requests for one node collapse into 1 image →
 *    force sync so all N render. (H2)
 *  - `alreadyPending`: an async batch for this node is in flight; re-enqueuing
 *    would submit (and bill) a second batch → skip. (H1)
 */
export function planRun(opts: {
  asyncGen: boolean
  asyncCapable: boolean
  inChain: boolean
  batchCount: number
  alreadyPending: boolean
}): RunPlan {
  const wantAsync = opts.asyncGen && opts.asyncCapable && !opts.inChain && opts.batchCount <= 1
  if (!wantAsync) return 'sync'
  if (opts.alreadyPending) return 'skip'
  return 'async'
}

export interface ImageModelDef {
  id: string
  name: string
  provider: string
  tooltip: string
  price: string
  cost: number
  deprecated: boolean
  /** Subset of ASPECT_RATIOS the model actually accepts. Empty = no filter. */
  aspect_ratios: string[]
}

// Hardcoded fallback — see useGenerateVideo.ts for the same pattern.
// Registry-derived values override this once /api/registry/models
// resolves; cloud mode (no backend) keeps using these values.
const GEMINI_FLASH_AR = ['1:1', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '16:9', '9:16', '21:9', '4:1', '1:4', '8:1', '1:8']
// NB2 Lite: official docs list 10 ratios — no 4:1/1:4/8:1/1:8 panoramics.
const GEMINI_LITE_AR = ['1:1', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '16:9', '9:16', '21:9']
const GEMINI_PRO_AR = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']
const OPENAI_AR = ['1:1', '3:2', '2:3', '16:9', '9:16', '21:9']
const RECRAFT_AR = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16']
const FLUX_AR = ['1:1', '4:3', '3:4', '16:9', '9:16']
const IMAGEN_AR = ['1:1', '16:9', '9:16', '4:3', '3:4']
const ATLAS_FLUX_AR = ['1:1', '4:3', '3:4', '16:9', '9:16']

const IMAGE_MODELS_FALLBACK: ImageModelDef[] = [
  // Google Gemini — text-to-image & image-to-image (pass ref images for editing)
  { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2', provider: 'gemini', tooltip: 'Gemini 3.1 Flash — fast T→I / I→I, 0.5K–4K, extended aspect ratios', price: '$0.067', cost: 0.067, deprecated: false, aspect_ratios: GEMINI_FLASH_AR },
  // Lite: Google only supports 1K (2K/4K rejected live 2026-07-01; 0.5K
  // unconfirmed). 1K price is exactly half of NB2's 1K.
  { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite', provider: 'gemini', tooltip: 'Google Gemini — Nano Banana 2 Lite, fastest/cheapest, 1K', price: '$0.034', cost: 0.034, deprecated: false, aspect_ratios: GEMINI_LITE_AR },
  { id: 'gemini-3-pro-image', name: 'Nano Banana Pro', provider: 'gemini', tooltip: 'Gemini 3 Pro — best quality, text rendering, 1K–4K', price: '$0.134', cost: 0.134, deprecated: false, aspect_ratios: GEMINI_PRO_AR },
  // OpenAI
  { id: 'gpt-image-2', name: 'GPT Image 2', provider: 'openai', tooltip: 'OpenAI gpt-image-2 — multi-ref edit, text fidelity. Draft (low) / 1K (medium) / FHD–4K (high). ≥2K experimental per OpenAI.', price: '$0.053', cost: 0.053, deprecated: false, aspect_ratios: OPENAI_AR },
  // Recraft V4
  { id: 'recraftv4', name: 'Recraft V4', provider: 'recraft', tooltip: 'Recraft V4 — fast raster, 1MP', price: '$0.04', cost: 0.04, deprecated: false, aspect_ratios: RECRAFT_AR },
  { id: 'recraftv4_pro', name: 'Recraft V4 Pro', provider: 'recraft', tooltip: 'Recraft V4 Pro — high-quality raster, 4MP', price: '$0.25', cost: 0.25, deprecated: false, aspect_ratios: RECRAFT_AR },
  { id: 'recraftv4_vector', name: 'Recraft V4 Vector', provider: 'recraft', tooltip: 'Recraft V4 Vector — SVG output (raster preview)', price: '$0.08', cost: 0.08, deprecated: false, aspect_ratios: RECRAFT_AR },
  { id: 'recraftv4_pro_vector', name: 'Recraft V4 Pro Vector', provider: 'recraft', tooltip: 'Recraft V4 Pro Vector — high-quality SVG (raster preview)', price: '$0.30', cost: 0.30, deprecated: false, aspect_ratios: RECRAFT_AR },
  // Flux (BFL Cloud)
  { id: 'flux-2-klein-4b', name: 'Flux 2 Klein 4B', provider: 'flux-cloud', tooltip: 'Black Forest Labs 4B via BFL API', price: '~$0.014', cost: 0.014, deprecated: false, aspect_ratios: FLUX_AR },
  { id: 'flux-2-klein-9b', name: 'Flux 2 Klein 9B', provider: 'flux-cloud', tooltip: 'Black Forest Labs 9B via BFL API', price: '~$0.015', cost: 0.015, deprecated: false, aspect_ratios: FLUX_AR },
  // Flux (Local GPU)
  { id: 'local/flux-2-klein-4b', name: 'Flux 2 Klein 4B (Local)', provider: 'local', tooltip: 'Run on your GPU', price: 'Free', cost: 0, deprecated: false, aspect_ratios: FLUX_AR },
  { id: 'local/flux-2-klein-9b', name: 'Flux 2 Klein 9B (Local)', provider: 'local', tooltip: 'Run on your GPU (24GB+ VRAM)', price: 'Free', cost: 0, deprecated: false, aspect_ratios: FLUX_AR },
  // Google Imagen 4 — text-to-image only, sunset 2026-06-24
  { id: 'imagen-4.0-ultra-generate-001', name: 'Imagen 4 Ultra', provider: 'imagen', tooltip: 'Imagen 4 Ultra — max detail, up to 2K (sunset 2026-06-24)', price: '$0.06', cost: 0.06, deprecated: false, aspect_ratios: IMAGEN_AR },
  { id: 'imagen-4.0-fast-generate-001', name: 'Imagen 4 Fast', provider: 'imagen', tooltip: 'Imagen 4 Fast — quick iterations (sunset 2026-06-24)', price: '$0.02', cost: 0.02, deprecated: false, aspect_ratios: IMAGEN_AR },
  // Atlas Cloud
  { id: 'atlas-flux-2-pro', name: 'Flux 2 Pro (Atlas)', provider: 'atlas', tooltip: 'Atlas Cloud — Flux 2 Pro 32B, T2I + I2I (single ref), up to 2048x2048', price: '$0.04', cost: 0.04, deprecated: false, aspect_ratios: ATLAS_FLUX_AR },
]

export const IMAGE_MODELS: ImageModelDef[] = IMAGE_MODELS_FALLBACK

function registryToImageModelDef(m: RegistryModel): ImageModelDef {
  // The BFL image provider registers itself as 'flux-cloud' in the
  // frontend ImageProvider map; the backend registry uses the simpler
  // 'flux'. Rename on the way out so runSingle's provider switch still
  // finds the right API key.
  const provider = m.provider === 'flux' ? 'flux-cloud' : m.provider
  const cost = m.cost_per_call ?? 0
  const price = cost === 0 ? 'Free'
    : m.provider === 'flux' ? `~$${cost}`
    : `$${cost}`
  return {
    id: m.id,
    name: m.name,
    provider,
    tooltip: m.tooltip ?? '',
    price,
    cost,
    deprecated: m.deprecated,
    aspect_ratios: m.aspect_ratios ?? [],
  }
}

export function useImageModels(): ImageModelDef[] {
  const registry = useModelRegistry('image')
  return useMemo(() => {
    if (registry.length === 0) return IMAGE_MODELS_FALLBACK
    return registry.map(registryToImageModelDef)
  }, [registry])
}


export const ASPECT_RATIOS = [
  { value: '', label: 'Auto' },
  { value: '1:1', label: '1:1 Square' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '4:5', label: '4:5' },
  { value: '5:4', label: '5:4' },
  { value: '16:9', label: '16:9 Wide' },
  { value: '9:16', label: '9:16 Vertical' },
  { value: '21:9', label: '21:9 Cinematic' },
  { value: '4:1', label: '4:1 Banner' },
  { value: '1:4', label: '1:4 Tall' },
  { value: '8:1', label: '8:1 Ultra-wide' },
  { value: '1:8', label: '1:8 Ultra-tall' },
]

export const RESOLUTIONS = [
  { value: '', label: 'Auto' },
  { value: 'Draft', label: 'Draft' },
  { value: '0.5K', label: '0.5K' },
  { value: '1K', label: '1K' },
  { value: 'FHD', label: 'FHD' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

const MAX_REFS = 14
const MAX_HISTORY = 50

export function useGenerateImage(id: string, data: GenerateImageNodeData, selected: boolean | undefined) {
  const { updateNodeData, getNodes, getEdges, setEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { openPreview } = useMediaPreview()
  const { apiKey, openaiApiKey, recraftApiKey, bflApiKey, atlasApiKey, localServerUrl } = useSettings()

  // Dynamic image pins (same pattern as LLM media pins)
  const connectedImageCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('image-')).length
  )
  const imageCount = Math.min(connectedImageCount + 1, MAX_REFS)
  const imageSlots: SlotDef[] = Array.from({ length: imageCount }, (_, i) => ({
    id: `image-${i}`,
    label: `Ref ${i + 1}`,
    type: 'image' as const,
  }))

  useEffect(() => {
    updateNodeInternals(id)
  }, [imageCount, id, updateNodeInternals])

  const [selectedModel, setSelectedModel] = useState(
    typeof data.selectedModel === 'string' ? data.selectedModel : 'gpt-image-2'
  )
  // These seven refs back the values runSingle reads — runSingle is a
  // long-lived callback that outlives any single render, so reading the
  // state directly would see stale values. `useStateRef` fuses the
  // useState / useRef / syncing-useEffect triplet into one line each.
  const [aspectRatio, setAspectRatio, aspectRatioRef] = useStateRef(
    (data as Record<string, unknown>).aspectRatio as string || '16:9'
  )
  const [resolution, setResolution, resolutionRef] = useStateRef(
    (data as Record<string, unknown>).resolution as string || 'Draft'
  )
  // `inputLocked` freezes the current aspect-ratio and resolution dropdown
  // values. When ON: AR auto-adapt is skipped, FHD/0.5K model-switch resets
  // are skipped, dropdowns are disabled. Settings stay exactly as the user
  // left them. Reads legacy `resolutionLocked` key for nodes saved during
  // the brief life of the resolution-only flavor of this feature.
  const [inputLocked, setInputLocked] = useState<boolean>(
    Boolean(
      (data as Record<string, unknown>).inputLocked
      ?? (data as Record<string, unknown>).resolutionLocked,
    ),
  )
  const [useGrounding, setUseGrounding, groundingRef] = useStateRef(
    Boolean((data as Record<string, unknown>).useGrounding)
  )
  const [editMode, setEditMode, editModeRef] = useStateRef(
    Boolean((data as Record<string, unknown>).editMode)
  )
  const [thinking, setThinking, thinkingRef] = useStateRef(
    typeof (data as Record<string, unknown>).thinking === 'boolean'
      ? (data as Record<string, unknown>).thinking as boolean
      : true,
  )
  // Pre-crop refs to match output AR before sending. Default OFF — refs are
  // sent intact and the model decides how to align AR. ON: legacy behavior
  // that crops center to output AR (useful when iterating on a single AR
  // chain and you want input/output to stay byte-aligned).
  const [cropRefs, setCropRefs, cropRefsRef] = useStateRef(
    Boolean((data as Record<string, unknown>).cropRefs),
  )
  // Async mode: Batch API at 50% cost. run() awaits the result, so cascades
  // stay correct; latency is unbounded (24h SLA, usually minutes).
  const [asyncGen, setAsyncGen, asyncGenRef] = useStateRef(
    Boolean((data as Record<string, unknown>).asyncGen),
  )
  // OpenAI gpt-image input_fidelity — 'high' preserves ref faces/details at
  // the cost of more input image tokens. Applied only on /v1/images/edits
  // (refs present). Persisted on the node.
  const [inputFidelity, setInputFidelity, inputFidelityRef] = useStateRef<'low' | 'high'>(
    (data as Record<string, unknown>).inputFidelity === 'high' ? 'high' : 'low',
  )
  // OpenAI gpt-image quality knob — 'auto' derives from resolution preset
  // (Draft→low / 1K→medium / FHD+→high); explicit value overrides.
  const [quality, setQuality, qualityRef] = useStateRef<'auto' | 'low' | 'medium' | 'high'>(
    (() => {
      const v = (data as Record<string, unknown>).quality
      return v === 'low' || v === 'medium' || v === 'high' || v === 'auto' ? v : 'auto'
    })(),
  )
  const [localPrompt, setLocalPrompt] = useState(String(data.prompt ?? ''))
  const [imageB64, setImageB64, imageB64Ref] = useStateRef<string | null>(null)
  const [compareSourceUrl, setCompareSourceUrl, compareSourceUrlRef] = useStateRef<string | null>(null)
  // True while we're waiting for historyPreview to load after a generation, so we can clear imageB64
  const waitingForPreviewRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()
  // Tracks the mediaId of the currently displayed fresh image (available before history updates)
  const [activeMediaId, setActiveMediaId] = useState<string | null>(null)

  // History state and navigation
  const {
    historyIds,
    historyIndex,
    historyPreview,
    historyThumbs,
    historyExpanded,
    navigateHistory,
    setHistoryIds,
    setHistoryIndex,
    setHistoryExpanded,
    userNavigatedRef,
  } = useGenerateImageHistory({
    nodeId: id,
    historyIdsFromData: data.historyIds ?? [],
  })

  // Review status badges for history items
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStatus | null>>({})

  useEffect(() => {
    if (historyIds.length === 0) return
    let cancelled = false
    historyIds.forEach(mid => {
      if (mid && !(mid in reviewStatuses)) {
        fetchReviewStatus(mid).then(status => {
          if (!cancelled) {
            setReviewStatuses(prev => ({ ...prev, [mid]: status }))
          }
        })
      }
    })
    return () => { cancelled = true }
  }, [historyIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // When user navigates to a history item, update the output
  useEffect(() => {
    if (!userNavigatedRef.current) return
    userNavigatedRef.current = false
    if (historyIndex >= 0 && historyIds[historyIndex]) {
      const mid = historyIds[historyIndex]
      updateNodeData(id, { mediaId: mid })
      setImageB64(null)
    }
  }, [historyIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear base64 once historyPreview blob URL is ready after a fresh generation.
  // This avoids keeping ~3 MB of base64 in state after the image is safely in IDB.
  useEffect(() => {
    if (waitingForPreviewRef.current && historyPreview) {
      waitingForPreviewRef.current = false
      setImageB64(null)
    }
  }, [historyPreview])

  // Arrow keys to navigate history when node is selected
  // Use capture phase to intercept before React Flow moves the node
  useEffect(() => {
    if (!selected || historyIds.length < 2) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        navigateHistory(-1)
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        navigateHistory(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [selected, historyIds.length, navigateHistory])

  useEffect(() => { if (data._stop) { setLoading(false); setError('') } }, [data._stop])

  // Current media ID — activeMediaId (set with imageB64) > data.mediaId > historyIds fallback
  const currentMediaId = activeMediaId ?? (data.mediaId as string | undefined) ?? historyIds[historyIndex] ?? null
  const currentMediaIdRef = useRef(currentMediaId)
  currentMediaIdRef.current = currentMediaId

  const handleFavoriteToggle = useCallback(async (mid: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // Optimistic update
    setReviewStatuses(prev => {
      const cur = prev[mid]
      return {
        ...prev,
        [mid]: cur
          ? { ...cur, favorite: !cur.favorite }
          : { status: null, reviewed_by: null, reviewed_at: null, comments_count: 0, drawings_count: 0, favorite: true },
      }
    })
    const ok = await toggleFavorite(mid)
    if (!ok) {
      setReviewStatuses(prev => {
        const cur = prev[mid]
        return cur ? { ...prev, [mid]: { ...cur, favorite: !cur.favorite } } : prev
      })
    }
  }, [])

  // Check if prompt pin is connected
  const hasPromptEdge = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'prompt-in')
  )

  // Subscribe to upstream prompt changes for live preview. Goes through
  // resolveSourceText so the preview reflects content INSIDE a subnet
  // source — reading src.data directly returned localPrompt fallback for
  // every subnet source, leaving the prompt preview stuck on the local
  // textarea value.
  const activePrompt = useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'prompt-in')
    if (!edge) return localPrompt
    const txt = resolveSourceText(edge.source, edge.sourceHandle ?? '', state.nodes, state.edges)
    return txt || localPrompt
  })

  const imageModels = useImageModels()
  const modelInfo = imageModels.find(m => m.id === selectedModel) ?? imageModels[0] ?? IMAGE_MODELS_FALLBACK[0]

  // Auto-clamp: when the model changes, if the previously-selected AR is not
  // in the new model's supported list, reset to Auto. Without this, switching
  // from Gemini Flash (8:1) to OpenAI silently lets the provider snap to 16:9.
  useEffect(() => {
    if (!aspectRatio) return
    if (modelInfo.aspect_ratios.length === 0) return
    if (modelInfo.aspect_ratios.includes(aspectRatio)) return
    setAspectRatio('')
    updateNodeData(id, { aspectRatio: '' })
  }, [selectedModel, modelInfo.aspect_ratios]) // eslint-disable-line react-hooks/exhaustive-deps

  // FHD is OpenAI-only (gpt-image-2 size constraint maps to 1920×1088). When
  // the model switches to a non-openai provider, reset to Auto so the
  // dropdown selection matches what the active provider actually accepts.
  // The user can opt out via the resolution lock.
  useEffect(() => {
    if (inputLocked) return
    if (resolution !== 'FHD') return
    if (modelInfo.provider === 'openai') return
    setResolution('')
    updateNodeData(id, { resolution: '' })
  }, [selectedModel, modelInfo.provider, inputLocked]) // eslint-disable-line react-hooks/exhaustive-deps

  // 0.5K is Flash-only (gemini-3.1-flash-image / NB2 Lite). Reset to Auto if
  // the model changes off Flash while 0.5K was selected. The user can opt
  // out via the resolution lock.
  useEffect(() => {
    if (inputLocked) return
    if (resolution !== '0.5K') return
    if (modelInfo.id === 'gemini-3.1-flash-image' || modelInfo.id === 'gemini-3.1-flash-lite-image') return
    setResolution('')
    updateNodeData(id, { resolution: '' })
  }, [selectedModel, modelInfo.id, inputLocked]) // eslint-disable-line react-hooks/exhaustive-deps

  // Draft is gpt-image-2-only (maps to low quality, 1024² at ~$0.006/img).
  // Reset to Auto if the model changes off gpt-image-2 while Draft was
  // selected. The user can opt out via the resolution lock.
  useEffect(() => {
    if (inputLocked) return
    if (resolution !== 'Draft') return
    if (modelInfo.id === 'gpt-image-2') return
    setResolution('')
    updateNodeData(id, { resolution: '' })
  }, [selectedModel, modelInfo.id, inputLocked]) // eslint-disable-line react-hooks/exhaustive-deps

  // NB2 Pro (gemini-3-pro-image) is configured to default to max quality
  // (4K). 1K is hidden from the dropdown because it costs the same as 2K, so
  // any stale 1K selection is upgraded to 4K (the new default). 2K is left
  // alone — it's still in the dropdown as an explicit cost-saving choice.
  // The user can opt out via the resolution lock.
  useEffect(() => {
    if (inputLocked) return
    if (resolution !== '1K') return
    if (modelInfo.id !== 'gemini-3-pro-image') return
    setResolution('4K')
    updateNodeData(id, { resolution: '4K' })
  }, [selectedModel, modelInfo.id, inputLocked]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-AR-adapt from connected input image: REMOVED on user request
  // 2026-06-15. Aspect ratio is now whatever the user picks in the dropdown
  // and never auto-overwrites on edge connect.

  function swapRefs() {
    setEdges(eds => {
      const e0 = eds.find(e => e.target === id && e.targetHandle === 'image-0')
      const e1 = eds.find(e => e.target === id && e.targetHandle === 'image-1')
      if (!e0 || !e1) return eds
      return eds.map(e => {
        if (e.id === e0.id) return { ...e, source: e1.source, sourceHandle: e1.sourceHandle }
        if (e.id === e1.id) return { ...e, source: e0.source, sourceHandle: e0.sourceHandle }
        return e
      })
    })
  }

  const promptForEstimate = pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt
  const editRefCount = (editMode && currentMediaId) ? 1 : 0
  const estimate = estimateCost(selectedModel, 'generate_image', promptForEstimate, connectedImageCount + editRefCount, 0, 1, resolution, thinking)
  // Async (Batch API) capability gates the ASY toggle and halves the estimate.
  const asyncCapable = modelInfo.provider === 'openai'
    || (modelInfo.provider === 'gemini' && geminiSupportsBatch(selectedModel))
  const asyncActive = asyncGen && asyncCapable
  const estimatedLabel = formatCostEstimate(estimate.costUsd * (asyncActive ? 0.5 : 1))

  const [batchCount, setBatchCount, batchCountRef] = useStateRef(1)
  const [batchProgress, setBatchProgress] = useState(0)

  // Elapsed seconds while an async (batch) run is in flight — drives the
  // "Batch Xm Ys" status label. Driven off the JOB's submittedAt so the timer
  // survives the post-submit loading=false flip AND a page reload.
  const [asyncElapsed, setAsyncElapsed] = useState(0)
  const elapsedJob = useAsyncJobStore(s => selectJobForNode(s.jobs, id))
  const elapsedActive = data.asyncPending || (elapsedJob && elapsedJob.status !== 'done' && elapsedJob.status !== 'failed')
  useEffect(() => {
    if (!elapsedActive) { setAsyncElapsed(0); return }
    const t0 = elapsedJob?.submittedAt ?? Date.now()
    const tick = () => setAsyncElapsed(Math.max(0, Math.floor((Date.now() - t0) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [elapsedActive, elapsedJob?.submittedAt])

  // Dynamic output slots: one per batch slot when ×2/×4
  const outputSlots: SlotDef[] = useMemo(() => {
    if (batchCount <= 1) return [{ id: 'image-out', label: 'Image', type: 'image' as const }]
    return Array.from({ length: batchCount }, (_, i) => ({
      id: i === 0 ? 'image-out' : `image-out-${i}`,
      label: `${i + 1}`,
      type: 'image' as const,
    }))
  }, [batchCount])

  useEffect(() => { updateNodeInternals(id) }, [batchCount, id, updateNodeInternals])

  // Ref to accumulate history IDs atomically during batch runs
  const batchHistoryRef = useRef<string[]>([])

  // Idempotency guard for the async consumer effect — StrictMode double-
  // invokes the effect with the same closure while req.resultMediaId is still
  // truthy, which would double-fire addCost. Keyed by mediaId.
  const asyncConsumedRef = useRef<Set<string>>(new Set())

  /**
   * Run a single generation. When `batchAccum` is provided (batch mode),
   * results are appended there instead of calling setHistoryIds/updateNodeData
   * so the caller can do a single merged update after all promises settle.
   */
  const runSingle = useCallback(async (batchAccum?: string[]): Promise<void> => {
    const rawPrompt = pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt
    if (!rawPrompt.trim()) { setError('Write a prompt'); return }
    const prompt = rawPrompt.trim()
    const refs = await pullAllMedia(id, 'image-', getNodes, getEdges)
    // Edit mode: prepend the last generated image as iterative base. When no
    // prior gen exists but the user has connected an input image (Ref 1), that
    // image already sits at refs[0] via pullAllMedia and serves as the edit
    // target — EDIT is then a no-op at the refs level but stays semantically
    // meaningful (cost estimate already counts it via connectedImageCount).
    if (editModeRef.current && currentMediaIdRef.current) {
      const lastFile = await loadMedia(currentMediaIdRef.current)
      if (lastFile) refs.unshift(lastFile)
    }
    // Save compare source: ref image if connected, otherwise current output (previous gen or history)
    if (compareSourceUrlRef.current) URL.revokeObjectURL(compareSourceUrlRef.current)
    if (refs.length > 0) {
      setCompareSourceUrl(URL.createObjectURL(refs[0]))
    } else if (imageB64Ref.current) {
      const resp = await fetch(`data:image/png;base64,${imageB64Ref.current}`)
      setCompareSourceUrl(URL.createObjectURL(await resp.blob()))
    } else if (currentMediaIdRef.current) {
      const prevFile = await loadMedia(currentMediaIdRef.current)
      if (prevFile) setCompareSourceUrl(URL.createObjectURL(prevFile))
    }
    const providerKey = modelInfo.provider === 'flux-cloud' ? bflApiKey
                     : modelInfo.provider === 'local' ? localServerUrl
                     : modelInfo.provider === 'openai' ? openaiApiKey
                     : modelInfo.provider === 'recraft' ? recraftApiKey
                     : modelInfo.provider === 'atlas' ? atlasApiKey
                     : apiKey
    const currentAspectRatio = aspectRatioRef.current
    const currentResolution = resolutionRef.current
    const asyncCapableRun = modelInfo.provider === 'openai'
      || (modelInfo.provider === 'gemini' && geminiSupportsBatch(selectedModel))
    const alreadyPending = !!(getNodes().find(n => n.id === id)?.data as Record<string, unknown> | undefined)?.asyncPending
    const plan = planRun({
      asyncGen: asyncGenRef.current,
      asyncCapable: asyncCapableRun,
      inChain: isChainRunning(),
      batchCount: batchCountRef.current,
      alreadyPending,
    })
    if (plan === 'skip') {
      // H1: an async batch for this node is already in flight — don't bill a second one.
      useCanvasStore.getState().addLog('[batch] skip · node already queued')
      return
    }
    const runAsync = plan === 'async'
    const imageOptions = {
      ...(currentAspectRatio ? { aspectRatio: currentAspectRatio } : {}),
      ...(currentResolution ? { imageSize: currentResolution } : {}),
      ...(groundingRef.current ? { useGrounding: true } : {}),
      ...(thinkingRef.current === false ? { thinking: false } : {}),
      ...(runAsync ? { async: true } : {}),
      ...(modelInfo.provider === 'openai' && inputFidelityRef.current === 'high'
        ? { inputFidelity: 'high' as const }
        : {}),
      ...(modelInfo.provider === 'openai' && qualityRef.current !== 'auto'
        ? { quality: qualityRef.current }
        : {}),
    }
    // Pre-crop refs to output AR only when the user opted in via the CROP
    // toggle. Default: send refs intact and let the model handle AR mismatch.
    const sentRefs = cropRefsRef.current
      ? await Promise.all(refs.map(f => cropImageFileToAspectRatio(f, currentAspectRatio)))
      : refs
    if (runAsync && modelInfo.provider === 'gemini') {
      const resolvedModelId = resolveModel(selectedModel)
      const body = await buildGeminiImageBody(prompt, resolvedModelId, sentRefs.length ? sentRefs : undefined, imageOptions)
      enqueueAsyncRequest({
        nodeId: id, key: id, body, bytes: JSON.stringify(body).length, modelId: resolvedModelId, provider: 'gemini', bundleKey: resolvedModelId,
        apiKey,
        meta: { prompt, modelName: modelInfo.name, resolution: currentResolution || undefined, aspectRatio: currentAspectRatio || undefined },
      })
      updateNodeData(id, { asyncPending: true })
      return
    }
    if (runAsync && modelInfo.provider === 'openai') {
      const size = computeSize(currentAspectRatio || undefined, currentResolution || undefined)
      const quality = qualityRef.current === 'auto'
        ? resolutionToQuality(currentResolution || undefined)
        : qualityRef.current
      const hasRefs = sentRefs.length > 0
      const body: Record<string, unknown> = { model: selectedModel, prompt, n: 1, size, quality }
      if (hasRefs && inputFidelityRef.current === 'high') body.input_fidelity = 'high'
      enqueueAsyncRequest({
        nodeId: id, key: id, body, bytes: JSON.stringify(body).length,
        modelId: selectedModel, provider: 'openai',
        bundleKey: `${selectedModel}|${hasRefs ? 'edits' : 'gen'}`,
        apiKey: openaiApiKey,
        refs: hasRefs ? sentRefs : undefined,
        meta: { prompt, modelName: modelInfo.name, resolution: currentResolution || undefined, aspectRatio: currentAspectRatio || undefined },
      })
      updateNodeData(id, { asyncPending: true })
      return
    }
    const r = await api.generateImage(prompt, selectedModel, modelInfo.provider, providerKey, sentRefs.length ? sentRefs : undefined, imageOptions)
    if (!r.image_b64) { throw new Error(r.status || 'No image generated') }

    // Set base64 first so it's available for preview while we persist
    const mediaId = generateMediaId()
    setActiveMediaId(mediaId)
    setImageB64(r.image_b64)
    await applyImageResult({
      nodeId: id, mediaId, result: r, prompt, model: selectedModel, modelName: modelInfo.name,
      resolution: currentResolution || undefined, aspectRatio: currentAspectRatio || undefined,
    })

    if (batchAccum) {
      // Batch mode: append to shared mutable array; caller merges later
      batchAccum.push(mediaId)
      // Still update mediaId so downstream can pull the latest result
      updateNodeData(id, { mediaId })
      // Signal that we want to clear imageB64 once historyPreview loads
      waitingForPreviewRef.current = true
    } else {
      // Single mode: update history immediately
      const currentIds: string[] = (getNodes().find(n => n.id === id)?.data as Record<string, unknown>)?.historyIds as string[] ?? historyIds
      const newHistory = [...currentIds, mediaId].slice(-MAX_HISTORY)
      updateNodeData(id, { mediaId, historyIds: newHistory, outputMediaIds: null })
      setHistoryIds(newHistory)
      // Signal that we want to clear imageB64 once historyPreview loads
      waitingForPreviewRef.current = true
    }

    // Track cost from API response or fall back to client-side estimate
    const actualUsage = r.usage
    const fallback = estimateCost(selectedModel, 'generate_image', rawPrompt, refs.length, 0, 1, currentResolution, thinkingRef.current)
    const costUsd = actualUsage?.cost_usd ?? fallback.costUsd
    setLastCost(costUsd)
    useCanvasStore.getState().addCost({
      timestamp: new Date().toISOString(),
      nodeId: id,
      nodeName: 'Generate Image',
      model: selectedModel,
      inputTokens: actualUsage?.input_tokens ?? fallback.inputTokens,
      outputTokens: actualUsage?.output_tokens ?? fallback.outputTokens,
      costUsd,
    })
  }, [activePrompt, apiKey, openaiApiKey, recraftApiKey, bflApiKey, localServerUrl, modelInfo, id, updateNodeData, getNodes, getEdges, historyIds, selectedModel, setHistoryIds])

  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    setBatchProgress(0)
    try {
      if (batchCount <= 1) {
        await runSingle()
        setBatchProgress(1)
      } else {
        // Snapshot current history before parallel calls
        const currentIds: string[] = (getNodes().find(n => n.id === id)?.data as Record<string, unknown>)?.historyIds as string[] ?? historyIds
        const accum: string[] = []
        batchHistoryRef.current = accum

        const promises = Array.from({ length: batchCount }, (_, i) =>
          runSingle(accum).then(() => {
            setBatchProgress(p => p + 1)
          }).catch(e => {
            const msg = e instanceof Error ? e.message : String(e)
            setError(prev => prev ? `${prev}\n#${i + 1}: ${msg}` : `#${i + 1}: ${msg}`)
          })
        )
        await Promise.all(promises)

        // Merge all results into history in one update
        const mergedHistory = [...currentIds, ...accum].slice(-MAX_HISTORY)
        const outputMediaIds: Record<string, string> = {}
        accum.forEach((mid, i) => {
          outputMediaIds[i === 0 ? 'image-out' : `image-out-${i}`] = mid
        })
        updateNodeData(id, { historyIds: mergedHistory, outputMediaIds })
        setHistoryIds(mergedHistory)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    } finally {
      setLoading(false)
      setBatchProgress(0)
    }
  }, [batchCount, runSingle, id, getNodes, historyIds, updateNodeData, setHistoryIds])

  // Consume the background ASY result: when the poller resolves this node's
  // request, render the image (or surface the error) and clear the pending flag.
  const myJob = useAsyncJobStore(s => selectJobForNode(s.jobs, id))
  useEffect(() => {
    if (!myJob) return
    const req = myJob.requests.find(r => r.nodeId === id)
    if (!req) return
    if (req.error) {
      setError(req.error)
      updateNodeData(id, { asyncPending: false })
      useAsyncJobStore.getState().markConsumed(myJob.id, req.key)
      return
    }
    if (!req.resultMediaId) return
    const mediaId = req.resultMediaId
    if (asyncConsumedRef.current.has(mediaId)) return
    asyncConsumedRef.current.add(mediaId)
    const currentIds = (getNodes().find(n => n.id === id)?.data as Record<string, unknown>)?.historyIds as string[] ?? historyIds
    const newHistory = [...currentIds, mediaId].slice(-MAX_HISTORY)
    updateNodeData(id, { mediaId, historyIds: newHistory, outputMediaIds: null, asyncPending: false })
    setHistoryIds(newHistory)
    // M2: log the SUBMITTED snapshot's real cost (resolution-correct + already
    // batch-discounted by the poller), not a re-estimate from current node state.
    // Fall back to an estimate (×0.5) only when the response carried no usage.
    const usage = req.usage
    const est = estimateCost(myJob.modelId, 'generate_image', req.meta?.prompt ?? activePrompt, 0, 0, 1, req.meta?.resolution ?? resolutionRef.current, false)
    useCanvasStore.getState().addCost({
      timestamp: new Date().toISOString(), nodeId: id, nodeName: 'Generate Image',
      model: myJob.modelId,
      inputTokens: usage?.input_tokens ?? est.inputTokens,
      outputTokens: usage?.output_tokens ?? 0,
      costUsd: usage?.cost_usd ?? est.costUsd * 0.5,
      projectId: myJob.projectId, // H6: bill the job's project, not whatever is active at poll-resolution time
    })
    // markConsumed already drops the job once its last request is consumed, so a
    // single-request job is gone here and the old removeJob guard was dead. (L4)
    useAsyncJobStore.getState().markConsumed(myJob.id, req.key)
  }, [myJob, id])   // eslint-disable-line react-hooks/exhaustive-deps

  // On MOUNT only, reconcile a stale persisted "Batch · queued" flag: an OLD node
  // reloaded with asyncPending=true but no live job behind it (job long gone /
  // from a previous session) would otherwise be bricked by the re-run guard.
  // Mount-only so it never races a fresh run's legit pre-job debounce window. (L3)
  useEffect(() => {
    if (data.asyncPending && !selectJobForNode(useAsyncJobStore.getState().jobs, id)) {
      updateNodeData(id, { asyncPending: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    // State
    selectedModel, setSelectedModel,
    aspectRatio, setAspectRatio,
    resolution, setResolution,
    inputLocked, setInputLocked,
    useGrounding, setUseGrounding,
    editMode, setEditMode,
    thinking, setThinking,
    cropRefs, setCropRefs,
    inputFidelity, setInputFidelity,
    quality, setQuality,
    asyncGen, setAsyncGen,
    asyncCapable,
    asyncElapsed,
    asyncBatchStatus: elapsedJob?.batchStatus,
    asyncJobId: elapsedActive ? elapsedJob?.id : undefined,
    localPrompt, setLocalPrompt,
    imageB64,
    compareSourceUrl,
    loading,
    error,
    lastCost,
    activeMediaId,
    batchCount, setBatchCount,
    batchProgress,
    // History
    historyIds,
    historyIndex, setHistoryIndex,
    historyPreview,
    historyThumbs,
    historyExpanded, setHistoryExpanded,
    navigateHistory,
    userNavigatedRef,
    reviewStatuses,
    // Derived
    currentMediaId,
    modelInfo,
    hasPromptEdge,
    activePrompt,
    connectedImageCount,
    imageSlots,
    outputSlots,
    estimatedLabel,
    // Actions
    run,
    swapRefs,
    handleFavoriteToggle,
    openPreview,
    updateNodeData,
  }
}
