import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { useSettings } from '../../components/SettingsContext'
import { api } from '../../api'
import { pullText } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { useCanvasStore } from '../../stores/canvasStore'
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
  maxDuration: number
}

export const VIDEO_MODELS: VideoModelDef[] = [
  { id: 'seedance-2.0',   name: 'Seedance 2.0',       provider: 'muapi', tooltip: 'ByteDance — fast T2V/I2V, up to 2K',   price: '~$0.05',  cost: 0.05, ratios: ['16:9', '9:16', '4:3', '3:4'], qualities: ['basic', 'high'], maxDuration: 10 },
  { id: 'kling-3.0-std',  name: 'Kling 3.0 Standard',  provider: 'muapi', tooltip: 'Kuaishou — 720p, fast, affordable',     price: '~$0.50',  cost: 0.50, ratios: ['16:9', '9:16', '1:1'],        qualities: ['720p'],          maxDuration: 10 },
  { id: 'kling-3.0-pro',  name: 'Kling 3.0 Pro',       provider: 'muapi', tooltip: 'Kuaishou — 1080p, best quality, audio', price: '~$1.50',  cost: 1.50, ratios: ['16:9', '9:16', '1:1'],        qualities: ['1080p'],         maxDuration: 10 },
]


const POLL_INTERVAL_MS = 5000

export function useGenerateVideo(id: string, data: GenerateVideoNodeData) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { muApiKey } = useSettings()

  // -- UI state ---------------------------------------------------------------

  const [localPrompt, setLocalPrompt] = useState(String(data.prompt ?? ''))
  const [selectedModel, setSelectedModel] = useState(data.selectedModel ?? 'seedance-2.0')
  const [aspectRatio, setAspectRatio] = useState(data.aspectRatio ?? '16:9')
  const [duration, setDuration] = useState(data.duration ?? 5)
  const [quality, setQuality] = useState(data.quality ?? 'high')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(data.status ?? '')
  const [videoUrl, setVideoUrl] = useState(data.videoUrl ?? '')
  const [requestId, setRequestId] = useState(data.requestId ?? '')
  const [pollElapsed, setPollElapsed] = useState(0)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartRef = useRef(0)

  const modelInfo = VIDEO_MODELS.find(m => m.id === selectedModel) ?? VIDEO_MODELS[0]

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
        const result = await api.videoStatus(reqId, muApiKey)
        const s = (result.status ?? '').toLowerCase()
        setPollElapsed(Math.floor((Date.now() - pollStartRef.current) / 1000))

        if (s === 'completed' || s === 'complete' || s === 'done' || s === 'success') {
          stopPolling()
          const url = result.url ?? ''
          setVideoUrl(url)
          setStatus('completed')
          setLoading(false)
          updateNodeData(id, { videoUrl: url, status: 'completed', requestId: reqId })

          // Track cost (estimated)
          const isKling = selectedModel.startsWith('kling')
          const costEstimate = isKling ? duration * (selectedModel.includes('pro') ? 0.15 : 0.10) : (quality === 'high' ? 0.10 : 0.05)
          useCanvasStore.getState().addCost({
            timestamp: new Date().toISOString(),
            nodeId: id,
            nodeName: 'Generate Video',
            model: modelInfo.name,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: costEstimate,
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
        setStatus(`polling... (${msg})`)
      }
    }, POLL_INTERVAL_MS)
  }, [stopPolling, muApiKey, id, selectedModel, duration, quality, modelInfo.name, updateNodeData])

  // Cleanup polling on unmount
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

  // -- Check if prompt-in or image-in is connected ----------------------------

  const hasPromptEdge = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'prompt-in')
  )
  const hasImageEdge = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'image-in')
  )

  // Subscribe to upstream prompt for live preview
  const activePrompt = useStore(state => {
    const edge = state.edges.find(e => e.target === id && e.targetHandle === 'prompt-in')
    if (!edge) return localPrompt
    const src = state.nodes.find(n => n.id === edge.source)
    if (!src) return localPrompt
    const sd = src.data as Record<string, unknown>
    return String(sd.outputText ?? sd.text ?? sd.prompt ?? localPrompt)
  })

  // Detect mode: i2v when image is connected
  const mode = hasImageEdge ? 'i2v' : 't2v'

  // -- Sync quality/ratio when model changes ----------------------------------

  useEffect(() => {
    const info = VIDEO_MODELS.find(m => m.id === selectedModel)
    if (!info) return
    if (!info.qualities.includes(quality as typeof info.qualities[number])) {
      setQuality(info.qualities[0])
      updateNodeData(id, { quality: info.qualities[0] })
    }
    if (!info.ratios.includes(aspectRatio as typeof info.ratios[number])) {
      setAspectRatio(info.ratios[0])
      updateNodeData(id, { aspectRatio: info.ratios[0] })
    }
  }, [selectedModel]) // eslint-disable-line react-hooks/exhaustive-deps

  // -- Run --------------------------------------------------------------------

  const run = useCallback(async () => {
    const prompt = (pullText(id, 'prompt-in', getNodes, getEdges) || activePrompt).trim()
    if (!prompt) { setError('Write a prompt'); return }
    if (!muApiKey) { setError('Set MuAPI key in Settings'); return }

    setLoading(true)
    setError('')
    setStatus('submitting')
    setVideoUrl('')

    try {
      if (mode === 'i2v') {
        setError('Image-to-video: connect a publicly accessible image URL via text node. Local images not yet supported.')
        setLoading(false)
        return
      }

      const result = await api.generateVideo(prompt, muApiKey, {
        model: selectedModel,
        mode,
        aspectRatio,
        duration,
        quality,
        imageUrls: '',
      })

      if (!result.request_id) {
        throw new Error('No request_id returned')
      }

      const reqId = result.request_id
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
  }, [id, activePrompt, muApiKey, selectedModel, mode, aspectRatio, duration, quality, getNodes, getEdges, updateNodeData, startPolling])

  return {
    localPrompt, setLocalPrompt,
    selectedModel, setSelectedModel,
    aspectRatio, setAspectRatio,
    duration, setDuration,
    quality, setQuality,
    loading, error, status, videoUrl, requestId,
    pollElapsed,
    modelInfo,
    hasPromptEdge, hasImageEdge,
    activePrompt, mode,
    run,
    muApiKey,
  }
}

export default useGenerateVideo
