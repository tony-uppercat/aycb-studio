import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { useSettings } from '../../components/SettingsContext'
import { api, bridgeMedia } from '../../api'
import type { GenerateImageNodeData } from '../../types'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { saveMediaForProject, generateMediaId, loadMedia } from '../../mediaStore'
import { pullText, pullAllMedia, resolveSourceText, resolveSourceMediaId } from '../../hooks/useDataPropagation'
import { useGenerateImageHistory } from '../../hooks/useGenerateImageHistory'
import { useStateRef } from '../../hooks/useStateRef'
import { useModelRegistry, type RegistryModel } from '../../hooks/useModelRegistry'
import { reportNodeError } from '../../utils/nodeErrors'
import { useCanvasStore } from '../../stores/canvasStore'
import { estimateCost, formatCostEstimate } from '../../utils/costEstimate'
import { fetchReviewStatus, registerBridgeStem, saveMediaMeta, toggleFavorite, type ReviewStatus } from '../../utils/reviewStatus'

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
const GEMINI_PRO_AR = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9']
const OPENAI_AR = ['1:1', '3:2', '2:3', '16:9', '9:16', '21:9']
const RECRAFT_AR = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16']
const FLUX_AR = ['1:1', '4:3', '3:4', '16:9', '9:16']

const IMAGE_MODELS_FALLBACK: ImageModelDef[] = [
  // Google Gemini — text-to-image & image-to-image (pass ref images for editing)
  { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2', provider: 'gemini', tooltip: 'Gemini 3.1 Flash — fast T→I / I→I, 0.5K–4K, extended aspect ratios', price: '$0.067', cost: 0.067, deprecated: false, aspect_ratios: GEMINI_FLASH_AR },
  { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro', provider: 'gemini', tooltip: 'Gemini 3 Pro — best quality, text rendering, 1K–4K', price: '$0.134', cost: 0.134, deprecated: false, aspect_ratios: GEMINI_PRO_AR },
  // OpenAI
  { id: 'gpt-image-2', name: 'GPT Image 2', provider: 'openai', tooltip: 'OpenAI gpt-image-2 — multi-ref edit, text fidelity, 1K med / 2K high', price: '$0.211', cost: 0.211, deprecated: false, aspect_ratios: OPENAI_AR },
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
  { value: '1K', label: '1K' },
  { value: 'FHD', label: 'FHD' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

const MAX_REFS = 8
const MAX_HISTORY = 50

export function useGenerateImage(id: string, data: GenerateImageNodeData, selected: boolean | undefined) {
  const { updateNodeData, getNodes, getEdges, setEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { openPreview } = useMediaPreview()
  const { apiKey, openaiApiKey, recraftApiKey, bflApiKey, localServerUrl } = useSettings()

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
    typeof data.selectedModel === 'string' ? data.selectedModel : 'gemini-3.1-flash-image-preview'
  )
  // These seven refs back the values runSingle reads — runSingle is a
  // long-lived callback that outlives any single render, so reading the
  // state directly would see stale values. `useStateRef` fuses the
  // useState / useRef / syncing-useEffect triplet into one line each.
  const [aspectRatio, setAspectRatio, aspectRatioRef] = useStateRef(
    (data as Record<string, unknown>).aspectRatio as string || '16:9'
  )
  const [resolution, setResolution, resolutionRef] = useStateRef(
    (data as Record<string, unknown>).resolution as string || '1K'
  )
  const [useGrounding, setUseGrounding, groundingRef] = useStateRef(
    Boolean((data as Record<string, unknown>).useGrounding)
  )
  const [editMode, setEditMode, editModeRef] = useStateRef(
    Boolean((data as Record<string, unknown>).editMode)
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
  useEffect(() => {
    if (resolution !== 'FHD') return
    if (modelInfo.provider === 'openai') return
    setResolution('')
    updateNodeData(id, { resolution: '' })
  }, [selectedModel, modelInfo.provider]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-adapt: when an image is connected to image-0 (or its source mediaId
  // changes), measure the input dimensions and pick the closest supported AR
  // + a 1K/2K bucket. Fires only when the source mediaId actually changes —
  // model switches alone do not re-adapt, so manual choices stick.
  const sourceMediaIdImage0 = useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'image-0')
    if (!edge) return null
    return resolveSourceMediaId(edge.source, edge.sourceHandle ?? '', state.nodes, state.edges)
  })
  // The ref tracks the last mediaId we adapted to and is NEVER reset on
  // disconnect/transient null — that prevented a perceived bug where adding
  // an unrelated text edge appeared to change the resolution. Mechanism:
  // React Flow's edge updates can briefly null out the image-0 source mid
  // operation; resetting the ref then would let the next non-null re-fire
  // adapt and overwrite the user's manual choice. Keep the ref sticky:
  // only adapt when the connected mediaId is genuinely DIFFERENT from the
  // last one we adapted to.
  const lastAdaptedRef = useRef<string | null>(null)
  // Once the user picks an AR or resolution from the dropdowns, auto-adapt
  // must not override them anymore — node values always win.
  const userOverrodeRef = useRef(false)
  useEffect(() => {
    if (userOverrodeRef.current) return
    if (!sourceMediaIdImage0) return
    if (lastAdaptedRef.current === sourceMediaIdImage0) return
    let cancelled = false
    void (async () => {
      try {
        const file = await loadMedia(sourceMediaIdImage0)
        if (!file || cancelled || !file.type.startsWith('image/')) return
        // Image() reads dimensions from headers without decoding the full
        // pixel buffer — much faster than createImageBitmap, which keeps
        // the async window tiny so adapt completes before the user can
        // start typing or connecting other inputs.
        const url = URL.createObjectURL(file)
        const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
          const img = new Image()
          img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
          img.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
          img.src = url
        })
        if (!dims || cancelled) return
        const { w, h } = dims
        const targetRatio = w / h
        const candidates = modelInfo.aspect_ratios.length > 0
          ? modelInfo.aspect_ratios
          : ASPECT_RATIOS.map(a => a.value).filter((v): v is string => v !== '')
        let bestAr = ''
        let bestDelta = Infinity
        for (const ar of candidates) {
          const [a, b] = ar.split(':').map(Number)
          if (!a || !b) continue
          const delta = Math.abs(targetRatio - a / b)
          if (delta < bestDelta) { bestDelta = delta; bestAr = ar }
        }
        // Tolerance: if the input is far from any supported ratio, fall back
        // to Auto rather than forcing a bad match.
        if (bestDelta > 0.5) bestAr = ''
        // Resolution is NOT auto-adapted from input dimensions — 1K is the
        // standard default and the user explicitly bumps to 2K when needed.
        // Promoting to 2K for high-MP inputs surprised the user with extra
        // cost on every image edit / iteration.
        lastAdaptedRef.current = sourceMediaIdImage0
        setAspectRatio(bestAr)
        updateNodeData(id, { aspectRatio: bestAr })
      } catch (err) {
        console.warn('[GenerateImage] auto-adapt failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [sourceMediaIdImage0]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const estimate = estimateCost(selectedModel, 'generate_image', promptForEstimate, connectedImageCount + editRefCount, 0, 1, resolution)
  const estimatedLabel = formatCostEstimate(estimate.costUsd)

  const [batchCount, setBatchCount] = useState(1)
  const [batchProgress, setBatchProgress] = useState(0)

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
    // Edit mode: prepend the last generated image as reference for iterative editing
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
                     : apiKey
    const currentAspectRatio = aspectRatioRef.current
    const currentResolution = resolutionRef.current
    const imageOptions = {
      ...(currentAspectRatio ? { aspectRatio: currentAspectRatio } : {}),
      ...(currentResolution ? { imageSize: currentResolution } : {}),
      ...(groundingRef.current ? { useGrounding: true } : {}),
    }
    const r = await api.generateImage(prompt, selectedModel, modelInfo.provider, providerKey, refs.length ? refs : undefined, imageOptions)
    if (!r.image_b64) { throw new Error(r.status || 'No image generated') }

    // Generate mediaId and set it with imageB64 so both are in the same render batch
    const mediaId = generateMediaId()
    setActiveMediaId(mediaId)
    setImageB64(r.image_b64)

    const response = await fetch(`data:image/png;base64,${r.image_b64}`)
    const blob = await response.blob()
    const file = new File([blob], `generated_${Date.now()}.png`, { type: 'image/png' })
    await saveMediaForProject(mediaId, file)

    // Persist metadata client-side (works in cloud mode without backend)
    saveMediaMeta(mediaId, {
      prompt,
      model: selectedModel,
      model_name: modelInfo.name,
      aspect_ratio: currentAspectRatio || undefined,
      image_size: currentResolution || undefined,
      cost_usd: r.usage?.cost_usd,
      generated_at: new Date().toISOString(),
    })

    // Register mediaId → bridge stem so reviewStatus can find the .review.json sidecar.
    // Backend path: bridge_stem is already in the response (server handled the bridge).
    // Provider path (client-side): send to bridge now that we have the mediaId.
    if (r.bridge_stem) {
      registerBridgeStem(mediaId, r.bridge_stem)
    } else {
      // Fire-and-forget — does not block UI
      bridgeMedia(r.image_b64, mediaId, {
        prompt,
        model: selectedModel,
        modelName: modelInfo.name,
        aspectRatio: currentAspectRatio || undefined,
        imageSize: currentResolution || undefined,
        costUsd: r.usage?.cost_usd,
      }).catch(() => { /* silent */ })
    }

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
    const fallback = estimateCost(selectedModel, 'generate_image', rawPrompt, refs.length, 0, 1, currentResolution)
    const costUsd = actualUsage?.cost_usd ?? fallback.costUsd
    setLastCost(costUsd)
    useCanvasStore.getState().addCost({
      timestamp: new Date().toISOString(),
      nodeId: id,
      nodeName: 'Generate Image',
      model: modelInfo.name,
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

  // Called from dropdown onChange handlers — once the user has touched AR
  // or Resolution manually, auto-adapt is suppressed for the rest of the
  // node's life so node values always win over input-driven adaptation.
  const markManualOverride = useCallback(() => { userOverrodeRef.current = true }, [])

  return {
    // State
    selectedModel, setSelectedModel,
    aspectRatio, setAspectRatio,
    resolution, setResolution,
    markManualOverride,
    useGrounding, setUseGrounding,
    editMode, setEditMode,
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
