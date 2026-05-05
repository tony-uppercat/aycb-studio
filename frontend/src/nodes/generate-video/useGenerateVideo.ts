import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { useSettings } from '../../components/SettingsContext'
import { api, bridgeVideo } from '../../api'
import { pullText, pullAllMedia, pullMedia, resolveSourceText } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { useCanvasStore } from '../../stores/canvasStore'
import { useModelRegistry, type RegistryModel } from '../../hooks/useModelRegistry'
import { priceTier } from '../_shared/types'
import type { GenerateVideoNodeData } from '../../types'

// -- Video generation models --------------------------------------------------

export interface VideoModelDef {
  id: string
  name: string
  provider: string
  tooltip: string
  price: string
  cost: number
  ratios: string[]
  qualities: string[]
  minDuration: number
  maxDuration: number
}

// Hardcoded fallback — used before /api/registry/models resolves on
// first load, and in cloud mode where the backend isn't available to
// serve the registry. Mirrors src/registry.py; a drift test in the
// backend test suite guards against divergence. Consumers should call
// useVideoModels() for fresh data at runtime.
const VIDEO_MODELS_FALLBACK: VideoModelDef[] = [
  // fal.ai — Kling v3
  {
    id: 'fal-kling-v3-std', name: 'Kling 3.0 Omni Std', provider: 'fal',
    tooltip: 'fal.ai — Kling 3.0 Omni Standard, 3-15s, fast', price: '$0.084/s',
    cost: 0.084, ratios: ['16:9', '9:16', '1:1'],
    qualities: ['720p'], minDuration: 3, maxDuration: 15,
  },
  {
    id: 'fal-kling-v3-pro', name: 'Kling 3.0 Omni Pro', provider: 'fal',
    tooltip: 'fal.ai — Kling 3.0 Omni Pro, 3-15s, best quality', price: '$0.112/s',
    cost: 0.112, ratios: ['16:9', '9:16', '1:1'],
    qualities: ['1080p'], minDuration: 3, maxDuration: 15,
  },
  {
    id: 'fal-seedance-2.0', name: 'Seedance 2.0', provider: 'fal',
    tooltip: 'fal.ai — Seedance 2.0, 4-15s, I2V', price: '$0.30/s',
    cost: 0.30, ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    qualities: ['720p'], minDuration: 4, maxDuration: 15,
  },
  // Atlas Cloud — Seedance 2.0 (cheapest)
  {
    id: 'atlas-seedance-2.0-fast', name: 'Seedance 2.0 Fast', provider: 'atlas',
    tooltip: 'Atlas Cloud — Seedance 2.0 Fast', price: '$0.18/s',
    cost: 0.18, ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    qualities: ['720p'], minDuration: 4, maxDuration: 15,
  },
  {
    id: 'atlas-seedance-2.0', name: 'Seedance 2.0', provider: 'atlas',
    tooltip: 'Atlas Cloud — full quality Seedance 2.0', price: '$0.25/s',
    cost: 0.25, ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    qualities: ['720p'], minDuration: 4, maxDuration: 15,
  },
  // Atlas Cloud — Kling v3 (newly added 2026-04-26, cheapest Kling on the platform)
  {
    id: 'atlas-kling-v3-std', name: 'Kling 3.0 Std', provider: 'atlas',
    tooltip: 'Atlas Cloud — Kling 3.0 Std, 5/10s, cheapest Kling tier', price: '$0.071/s',
    cost: 0.071, ratios: ['16:9', '9:16', '1:1'],
    qualities: ['720p'], minDuration: 5, maxDuration: 10,
  },
  {
    id: 'atlas-kling-v3-pro', name: 'Kling 3.0 Pro', provider: 'atlas',
    tooltip: 'Atlas Cloud — Kling 3.0 Pro (O3), 5/10s, enhanced physics + lip-sync', price: '$0.095/s',
    cost: 0.095, ratios: ['16:9', '9:16', '1:1'],
    qualities: ['720p'], minDuration: 5, maxDuration: 10,
  },
  // PiAPI — Kling 3.0 Omni
  {
    id: 'kling-3.0-omni', name: 'Kling 3.0 Omni', provider: 'piapi',
    tooltip: 'PiAPI — Kling 3.0 Omni, 720p/1080p', price: '$0.10-0.15/s',
    cost: 0.10, ratios: ['16:9', '9:16', '1:1'],
    qualities: ['720p', '1080p'], minDuration: 3, maxDuration: 15,
  },
  // PiAPI — Seedance 2.0
  {
    id: 'seedance-2.0', name: 'Seedance 2.0', provider: 'piapi',
    tooltip: 'PiAPI — T2V/multi-ref, 4-15s', price: '$0.15/s',
    cost: 0.15, ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    qualities: ['standard'], minDuration: 4, maxDuration: 15,
  },
  {
    id: 'seedance-2.0-fast', name: 'Seedance 2.0 Fast', provider: 'piapi',
    tooltip: 'PiAPI — fast, lower cost', price: '$0.10/s',
    cost: 0.10, ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    qualities: ['standard'], minDuration: 4, maxDuration: 15,
  },
  // Vertex AI — Google Veo 3.1
  {
    id: 'vertex-veo-3.1', name: 'Veo 3.1', provider: 'vertex',
    tooltip: 'Google Vertex — Veo 3.1, native audio, up to 3 refs, 4-8s', price: '$0.40/s',
    cost: 0.40, ratios: ['16:9', '9:16'],
    qualities: ['720p', '1080p'], minDuration: 4, maxDuration: 8,
  },
  {
    id: 'vertex-veo-3.1-fast', name: 'Veo 3.1 Fast', provider: 'vertex',
    tooltip: 'Google Vertex — Veo 3.1 Fast, 4-8s', price: '$0.15/s',
    cost: 0.15, ratios: ['16:9', '9:16'],
    qualities: ['720p'], minDuration: 4, maxDuration: 8,
  },
]

// Back-compat export — prefer useVideoModels() at call sites that can
// accept a re-render on registry arrival. This const never mutates, so
// it stays safe for useState initializers that need a stable reference.
export const VIDEO_MODELS: VideoModelDef[] = VIDEO_MODELS_FALLBACK

function registryToVideoModelDef(m: RegistryModel): VideoModelDef {
  const costs = Object.values(m.cost_per_sec ?? {})
  const priceStr =
    costs.length === 0 ? 'Free' :
    costs.length === 1 ? `$${costs[0]}/s` :
    `$${Math.min(...costs)}-${Math.max(...costs)}/s`
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    tooltip: m.tooltip ?? '',
    price: priceStr,
    cost: costs.length ? Math.min(...costs) : 0,
    ratios: m.aspect_ratios,
    qualities: m.qualities,
    minDuration: m.allowed_durations.length ? Math.min(...m.allowed_durations) : 4,
    maxDuration: m.allowed_durations.length ? Math.max(...m.allowed_durations) : 15,
  }
}

/**
 * Returns video-capability models — registry-sourced when the backend
 * is available, otherwise the hardcoded fallback. Re-renders once when
 * /api/registry/models resolves.
 */
export function useVideoModels(): VideoModelDef[] {
  const registry = useModelRegistry('video')
  return useMemo(() => {
    if (registry.length === 0) return VIDEO_MODELS_FALLBACK
    return registry.map(registryToVideoModelDef)
  }, [registry])
}

const MAX_REFS = 12
const POLL_INTERVAL_MS = 5000

export function useGenerateVideo(id: string, data: GenerateVideoNodeData) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { apiKey, piApiKey, falApiKey, atlasApiKey } = useSettings()

  // -- UI state ---------------------------------------------------------------

  const [localPrompt, setLocalPrompt] = useState(String(data.prompt ?? ''))
  const [selectedModel, setSelectedModel] = useState(data.selectedModel ?? 'atlas-seedance-2.0')
  const [aspectRatio, setAspectRatio] = useState(data.aspectRatio ?? '21:9')
  const [duration, setDuration] = useState(data.duration ?? 5)
  const [quality, setQuality] = useState(data.quality ?? '720p')
  const [seed, setSeed] = useState<number>(() => {
    const v = (data as Record<string, unknown>).seed
    return typeof v === 'number' ? v : -1
  })
  const [modeOverride, setModeOverride] = useState<'t2v' | 'i2v' | 'multi-ref' | null>(() => {
    const v = (data as Record<string, unknown>).modeOverride
    return v === 't2v' || v === 'i2v' || v === 'multi-ref' ? v : null
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()
  const [status, setStatus] = useState(data.status ?? '')
  const [videoUrl, setVideoUrl] = useState(data.videoUrl ?? '')
  const [requestId, setRequestId] = useState(data.requestId ?? '')
  const [pollElapsed, setPollElapsed] = useState(0)

  // History — list of {stem, url} for generated videos
  const [historyIds, setHistoryIds] = useState<string[]>(data.historyIds as string[] ?? [])
  const [historyUrls, setHistoryUrls] = useState<string[]>(data.historyUrls as string[] ?? [])
  const [historyIndex, setHistoryIndex] = useState(Math.max(0, (data.historyIds as string[] ?? []).length - 1))

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartRef = useRef(0)
  const falEndpointRef = useRef('')  // stored from fal submit response for polling

  // Refs for values used inside startPolling (avoid stale closures)
  const historyIdsRef = useRef(historyIds)
  useEffect(() => { historyIdsRef.current = historyIds }, [historyIds])
  const historyUrlsRef = useRef(historyUrls)
  useEffect(() => { historyUrlsRef.current = historyUrls }, [historyUrls])
  const aspectRatioRef = useRef(aspectRatio)
  useEffect(() => { aspectRatioRef.current = aspectRatio }, [aspectRatio])
  const localPromptRef = useRef(localPrompt)
  useEffect(() => { localPromptRef.current = localPrompt }, [localPrompt])

  const videoModels = useVideoModels()
  const modelInfo = videoModels.find(m => m.id === selectedModel) ?? videoModels[0] ?? VIDEO_MODELS_FALLBACK[0]
  const isFal = modelInfo.provider === 'fal'
  const isAtlas = modelInfo.provider === 'atlas'
  const isVertex = modelInfo.provider === 'vertex'
  const activeApiKey = isFal ? falApiKey : isAtlas ? atlasApiKey : isVertex ? apiKey : piApiKey
  const activeProvider = isFal ? 'fal' : isAtlas ? 'atlas' : isVertex ? 'vertex' : 'piapi'

  // -- Dynamic image slots (same pattern as Generate Image) -------------------

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

  // -- Check connections ------------------------------------------------------

  const hasPromptEdge = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'prompt-in')
  )
  const hasVideoRef = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'video-ref')
  )
  const hasAudioRef = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'audio-ref')
  )

  // Walks subnets/bypass via resolveSourceText so the preview reflects content
  // INSIDE a subnet source — reading src.data directly fell back to localPrompt
  // for any subnet upstream.
  const activePrompt = useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'prompt-in')
    if (!edge) return localPrompt
    const txt = resolveSourceText(edge.source, edge.sourceHandle ?? '', state.nodes, state.edges)
    return txt || localPrompt
  })

  // Cost estimate
  const estimatedCost = `~$${(modelInfo.cost * duration).toFixed(2)}`

  // Detect mode — user override takes precedence over auto-detection
  const hasRefs = connectedImageCount > 0 || hasVideoRef || hasAudioRef
  const autoMode = !hasRefs ? 't2v'
    : (connectedImageCount <= 2 && !hasVideoRef && !hasAudioRef) ? 'i2v'
    : 'multi-ref'
  const mode = modeOverride ?? autoMode
  const modeRef = useRef(mode)
  useEffect(() => { modeRef.current = mode }, [mode])

  // -- Polling ----------------------------------------------------------------

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback((reqId: string) => {
    stopPolling()
    pollStartRef.current = Date.now()
    setPollElapsed(0)

    pollRef.current = setInterval(async () => {
      try {
        const result = await api.videoStatus(reqId, activeApiKey, activeProvider, falEndpointRef.current)
        const s = (result.status ?? '').toLowerCase()
        setPollElapsed(Math.floor((Date.now() - pollStartRef.current) / 1000))

        if (s === 'completed' || s === 'complete' || s === 'done' || s === 'success') {
          stopPolling()
          const url = result.url ?? ''
          setVideoUrl(url)
          setStatus('completed')
          setLoading(false)

          // Track cost (per-second pricing)
          const costUsd = modelInfo.cost * duration
          setLastCost(costUsd)
          useCanvasStore.getState().addCost({
            timestamp: new Date().toISOString(),
            nodeId: id,
            nodeName: 'Generate Video',
            model: modelInfo.name,
            inputTokens: 0,
            outputTokens: 0,
            costUsd,
          })

          // Bridge video to shared/Media/ and add to history
          bridgeVideo(url, {
            prompt: localPromptRef.current ?? '',
            model: selectedModel,
            modelName: modelInfo.name,
            aspectRatio: aspectRatioRef.current,
            duration,
            costUsd,
          }).then(stem => {
            if (stem) {
              const newIds = [...historyIdsRef.current, stem]
              const newUrls = [...historyUrlsRef.current, url]
              setHistoryIds(newIds)
              setHistoryUrls(newUrls)
              setHistoryIndex(newIds.length - 1)
              updateNodeData(id, {
                videoUrl: url, status: 'completed', requestId: reqId,
                mediaId: stem, historyIds: newIds, historyUrls: newUrls,
              })
            } else {
              updateNodeData(id, { videoUrl: url, status: 'completed', requestId: reqId })
            }
          }).catch(() => {
            updateNodeData(id, { videoUrl: url, status: 'completed', requestId: reqId })
          })
        } else if (s === 'failed' || s === 'error') {
          stopPolling()
          const errMsg = result.error ?? 'Generation failed'
          setError(errMsg)
          setStatus('failed')
          setLoading(false)
          reportNodeError(id, errMsg)
        } else {
          setStatus(s || 'processing')
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        // Stale / not-found request_id — stop polling and clear state
        if (/not found|404|invalid/i.test(msg)) {
          stopPolling()
          setError('Previous request expired. Click Run to start a new generation.')
          setStatus('failed')
          setLoading(false)
          updateNodeData(id, { requestId: '', status: 'failed' })
          return
        }
        setStatus(`polling... (${msg})`)
      }
    }, POLL_INTERVAL_MS)
  }, [stopPolling, activeApiKey, activeProvider, id, selectedModel, duration, quality, modelInfo, updateNodeData])

  useEffect(() => () => stopPolling(), [stopPolling])

  // Resume polling if we had a pending requestId
  useEffect(() => {
    if (data.requestId && data.status !== 'completed' && data.status !== 'failed' && !pollRef.current) {
      setRequestId(data.requestId)
      setLoading(true)
      startPolling(data.requestId)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // -- Stop signal ------------------------------------------------------------

  useEffect(() => {
    if (data._stop) {
      setLoading(false)
      setError('')
      stopPolling()
    }
  }, [data._stop, stopPolling])

  // -- Sync quality/ratio when model changes ----------------------------------

  useEffect(() => {
    const info = videoModels.find(m => m.id === selectedModel)
    if (!info) return
    if (!info.qualities.includes(quality)) {
      setQuality(info.qualities[0])
      updateNodeData(id, { quality: info.qualities[0] })
    }
    if (!info.ratios.includes(aspectRatio)) {
      setAspectRatio(info.ratios[0])
      updateNodeData(id, { aspectRatio: info.ratios[0] })
    }
    if (duration < info.minDuration) {
      setDuration(info.minDuration)
      updateNodeData(id, { duration: info.minDuration })
    }
    if (duration > info.maxDuration) {
      setDuration(info.maxDuration)
      updateNodeData(id, { duration: info.maxDuration })
    }
  }, [selectedModel]) // eslint-disable-line react-hooks/exhaustive-deps

  // -- Run --------------------------------------------------------------------

  const run = useCallback(async () => {
    const prompt = (pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt).trim()
    if (!prompt) { setError('Write a prompt'); return }
    if (!activeApiKey) {
      setError(isFal ? 'Set fal.ai key in Settings'
             : isAtlas ? 'Set Atlas Cloud key in Settings'
             : isVertex ? 'Set Gemini key in Settings'
             : 'Set PiAPI key in Settings')
      return
    }

    setLoading(true)
    setError('')
    setStatus('submitting')
    setVideoUrl('')

    try {
      // Collect references based on mode
      const curMode = modeRef.current
      let refImages: File[] = []
      if (curMode === 'i2v') {
        refImages = (await pullAllMedia(id, 'image-', getNodes, getEdges)).slice(0, 2)
      } else if (curMode === 'multi-ref') {
        refImages = await pullAllMedia(id, 'image-', getNodes, getEdges)
      }

      let refVideo: File | undefined
      if (hasVideoRef && curMode === 'multi-ref') {
        const { file } = await pullMedia(id, 'video-ref', getNodes, getEdges)
        if (file) refVideo = file
      }

      let audioUrl = ''
      if (hasAudioRef && curMode === 'multi-ref') {
        audioUrl = pullText(id, 'audio-ref', getNodes, getEdges) || ''
      }

      const result = await api.generateVideo(
        prompt, activeApiKey,
        { model: selectedModel, aspectRatio, duration, quality, audioUrl, seed },
        refImages.length > 0 ? refImages : undefined,
        refVideo,
      )

      const reqId = result.request_id || result.task_id
      if (!reqId) throw new Error('No request_id returned')

      // Store fal endpoint for polling
      if (isFal && result._fal_endpoint) falEndpointRef.current = result._fal_endpoint

      setRequestId(reqId)
      setStatus('submitted')
      updateNodeData(id, { requestId: reqId, status: 'submitted', prompt, selectedModel })

      startPolling(reqId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setLoading(false)
      reportNodeError(id, msg)
    }
  }, [id, activePrompt, activeApiKey, isFal, isAtlas, isVertex, activeProvider, selectedModel, aspectRatio, duration, quality, seed,
      hasVideoRef, hasAudioRef, getNodes, getEdges, updateNodeData, startPolling])

  const setMode = useCallback((m: 't2v' | 'i2v' | 'multi-ref') => {
    setModeOverride(m)
    updateNodeData(id, { modeOverride: m })
  }, [id, updateNodeData])

  const navigateHistory = useCallback((delta: number) => {
    const newIdx = Math.max(0, Math.min(historyIds.length - 1, historyIndex + delta))
    setHistoryIndex(newIdx)
    if (historyUrls[newIdx]) setVideoUrl(historyUrls[newIdx])
  }, [historyIds.length, historyIndex, historyUrls])

  return {
    localPrompt, setLocalPrompt,
    selectedModel, setSelectedModel,
    aspectRatio, setAspectRatio,
    duration, setDuration,
    quality, setQuality,
    seed, setSeed,
    loading, error, status, videoUrl, requestId,
    pollElapsed,
    modelInfo,
    imageSlots,
    connectedImageCount,
    hasPromptEdge, hasVideoRef, hasAudioRef,
    activePrompt, mode, setMode,
    run,
    activeApiKey,
    lastCost,
    estimatedCost,
    historyIds, historyIndex, navigateHistory,
  }
}

export default useGenerateVideo
