import { useCallback, useEffect, useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { api } from '../../api'
import { pullMedia, pullText } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { estimateCost, formatCostEstimate } from '../../utils/costEstimate'
import { useCanvasStore } from '../../stores/canvasStore'
import type { VideoAnalysisNodeData } from '../../types'

// ── LLM models available for video analysis ──────────────────────────────────

export const VIDEO_ANALYSIS_MODELS = [
  { id: 'gemini-3.1-flash-lite-preview',           name: 'Gemini 3.1 Flash-Lite',          deprecated: false, thinking: false, tooltip: 'Ultra-fast & cheap' },
  { id: 'gemini-3.1-flash-lite-preview:thinking',  name: 'Gemini 3.1 Flash-Lite (Think)',   deprecated: false, thinking: true,  tooltip: 'Flash-Lite with deep reasoning' },
  { id: 'gemini-3.1-pro-preview',                  name: 'Gemini 3.1 Pro',                  deprecated: false, thinking: true,  tooltip: 'Latest, always-thinking' },
  { id: 'gemini-3-flash-preview',                  name: 'Gemini 3 Flash',                  deprecated: false, thinking: false, tooltip: 'Fast, balanced, multimodal' },
  { id: 'gemini-3-flash-preview:thinking',         name: 'Gemini 3 Flash (Think)',           deprecated: false, thinking: true,  tooltip: 'Flash with deep reasoning' },
  { id: 'gemini-3-pro-preview',                    name: 'Gemini 3 Pro',                    deprecated: false, thinking: false, tooltip: 'Best quality, complex reasoning' },
  { id: 'gemini-3-pro-preview:thinking',           name: 'Gemini 3 Pro (Think)',             deprecated: false, thinking: true,  tooltip: 'Pro with deep reasoning' },
  { id: 'gemini-2.5-flash',                        name: 'Gemini 2.5 Flash',                deprecated: true,  thinking: false, tooltip: 'LEGACY — use 3.x instead' },
  { id: 'gemini-2.5-pro',                          name: 'Gemini 2.5 Pro',                  deprecated: true,  thinking: false, tooltip: 'LEGACY — use 3.x instead' },
] as const

export type ExtractionMode = 'sharpness' | 'cuts'

export const MAX_FRAMES_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export type FrameThumb = { b64: string; label: string; analysis?: string; timestamp?: number; filename?: string }

export function useVideoAnalysis(id: string, data: Record<string, unknown>) {
  const d = data as VideoAnalysisNodeData
  const { updateNodeData, getNodes, getEdges } = useReactFlow()

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedModel, setSelectedModel] = useState<string>(
    typeof d.selectedModel === 'string' ? d.selectedModel : 'gemini-3.1-flash-lite-preview'
  )
  const [maxFrames, setMaxFrames] = useState<number>(
    typeof d.maxFrames === 'number' ? d.maxFrames : 3
  )
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>(
    d.extractionMode === 'cuts' ? 'cuts' : 'sharpness'
  )
  const [cutSensitivity, setCutSensitivity] = useState<number>(
    typeof d.cutSensitivity === 'number' ? d.cutSensitivity : 0.4
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()

  // Result display state
  const [resultText, setResultText] = useState<string>(
    typeof d.outputText === 'string' ? d.outputText : ''
  )
  const [frameThumbs, setFrameThumbs] = useState<FrameThumb[]>(
    Array.isArray(d.frames) ? (d.frames as FrameThumb[]) : []
  )
  const [jsonOutput, setJsonOutput] = useState<string>(
    typeof d.jsonOut === 'string' ? d.jsonOut : ''
  )

  // ── Stop signal ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (d._stop) { setLoading(false); setError('') }
  }, [d._stop])

  // ── Sync from external data changes (undo/import) ─────────────────────────
  useEffect(() => {
    const incoming = typeof d.outputText === 'string' ? d.outputText : null
    if (incoming != null && incoming !== resultText) setResultText(incoming)
  }, [d.outputText]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (Array.isArray(d.frames)) {
      setFrameThumbs(d.frames as FrameThumb[])
    }
  }, [d.frames])

  // ── Check if prompt-in is connected ──────────────────────────────────────
  const hasPromptEdge = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'prompt-in')
  )

  // ── Cost estimate ─────────────────────────────────────────────────────────
  const modelInfo = VIDEO_ANALYSIS_MODELS.find(m => m.id === selectedModel) ?? VIDEO_ANALYSIS_MODELS[0]
  const estimate = estimateCost(selectedModel, 'analyze_video', '', 0, 0, maxFrames)
  const estimatedLabel = formatCostEstimate(estimate.costUsd)

  // ── Run ───────────────────────────────────────────────────────────────────
  const run = useCallback(async () => {
    const { file: videoFile } = await pullMedia(id, 'video-in', getNodes, getEdges)
    if (!videoFile) { setError('Connect a Video input'); return }

    const customPrompt = pullText(id, 'prompt-in', getNodes, getEdges)

    const thisNode = getNodes().find(n => n.id === id)
    const nodeName = (thisNode?.data as Record<string, unknown>)?.label as string || 'Video Analysis'

    setLoading(true)
    setError('')

    try {
      const fd = new FormData()
      fd.append('video', videoFile)
      fd.append('model', selectedModel)
      fd.append('do_embed', 'false')
      fd.append('mode', extractionMode)
      fd.append('cut_threshold', String(cutSensitivity))
      fd.append('n_frames', extractionMode === 'cuts' ? '0' : String(maxFrames))
      fd.append('export_folder', nodeName.replace(/[<>:"/\\|?*]/g, '_'))
      fd.append('video_name', videoFile.name.replace(/\.[^.]+$/, ''))
      if (customPrompt) fd.append('prompt', customPrompt)

      const r = await api.analyzeVideoAdvanced(fd)

      const text: string = r.text ?? ''
      const rawFrames: FrameThumb[] = r.frames ?? []

      const structuredOutput: Record<string, string> = {}
      rawFrames.forEach((f, i) => {
        structuredOutput[`frame_${String(i).padStart(4, '0')}`] = f.analysis ?? f.label ?? ''
      })
      const jsonText = JSON.stringify(structuredOutput, null, 2)

      setResultText(text)
      setFrameThumbs(rawFrames)
      setJsonOutput(jsonText)

      updateNodeData(id, {
        outputText: text,
        text,
        jsonOut: jsonText,
        frames: rawFrames,
        selectedModel,
        maxFrames,
        extractionMode,
        cutSensitivity,
      })

      const fallback = estimateCost(selectedModel, 'analyze_video', '', 0, 0, maxFrames)
      const costUsd = r.usage?.cost_usd ?? fallback.costUsd
      setLastCost(costUsd)
      useCanvasStore.getState().addCost({
        timestamp: new Date().toISOString(),
        nodeId: id,
        nodeName: 'Video Analysis',
        model: modelInfo.name,
        inputTokens: r.usage?.input_tokens ?? fallback.inputTokens,
        outputTokens: r.usage?.output_tokens ?? fallback.outputTokens,
        costUsd,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    } finally {
      setLoading(false)
    }
  }, [id, selectedModel, maxFrames, extractionMode, cutSensitivity, modelInfo, getNodes, getEdges, updateNodeData])

  // ── Update helpers ────────────────────────────────────────────────────────
  const updateModel = useCallback((value: string) => {
    setSelectedModel(value)
    updateNodeData(id, { selectedModel: value })
  }, [id, updateNodeData])

  const updateMaxFrames = useCallback((value: number) => {
    setMaxFrames(value)
    updateNodeData(id, { maxFrames: value })
  }, [id, updateNodeData])

  const updateExtractionMode = useCallback((mode: ExtractionMode) => {
    setExtractionMode(mode)
    updateNodeData(id, { extractionMode: mode })
  }, [id, updateNodeData])

  const updateCutSensitivity = useCallback((value: number) => {
    setCutSensitivity(value)
    updateNodeData(id, { cutSensitivity: value })
  }, [id, updateNodeData])

  return {
    selectedModel, maxFrames, extractionMode, cutSensitivity,
    loading, error, lastCost, resultText, frameThumbs, jsonOutput,
    hasPromptEdge, modelInfo, estimatedLabel,
    run,
    updateModel, updateMaxFrames, updateExtractionMode, updateCutSensitivity,
  }
}
