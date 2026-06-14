import { useCallback, useEffect, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { api } from '../../api'
import { useSettings } from '../../components/SettingsContext'
import { pullMedia, pullAllMedia } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { estimateCost } from '../../utils/costEstimate'
import { useCanvasStore } from '../../stores/canvasStore'
import { saveMediaForProject, generateMediaId } from '../../mediaStore'

const EDIT_MODES = [
  { value: 'EDIT_MODE_DEFAULT', label: 'Free Edit', needsMask: false },
  { value: 'EDIT_MODE_INPAINT_REMOVAL', label: 'Remove Object', needsMask: true },
  { value: 'EDIT_MODE_INPAINT_INSERTION', label: 'Insert Object', needsMask: true },
  { value: 'EDIT_MODE_BGSWAP', label: 'Background Swap', needsMask: false },
  { value: 'EDIT_MODE_OUTPAINT', label: 'Outpaint', needsMask: true },
  { value: 'EDIT_MODE_PRODUCT_IMAGE', label: 'Product Image', needsMask: false },
] as const

const MASK_MODES = [
  { value: 'MASK_MODE_BACKGROUND', label: 'Background' },
  { value: 'MASK_MODE_FOREGROUND', label: 'Foreground' },
  { value: 'MASK_MODE_SEMANTIC', label: 'Semantic' },
] as const

const ASPECT_RATIOS = [
  { value: '', label: 'Auto' },
  { value: '1:1', label: '1:1 Square' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9 Wide' },
  { value: '9:16', label: '9:16 Vertical' },
]

const EDIT_MODEL_OPTIONS = [
  { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2 (Gemini)', provider: 'gemini' },
  { id: 'imagen-3.0-capability-001', name: 'Imagen 3 (Vertex AI)', provider: 'imagen' },
]

const MAX_SUBJECTS = 4

export { EDIT_MODES, MASK_MODES, ASPECT_RATIOS, EDIT_MODEL_OPTIONS }

export function useImageEdit(id: string, data: Record<string, unknown>) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { apiKey } = useSettings()

  // Dynamic subject pins (same pattern as Generate Image refs)
  const connectedSubjectCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('subject-')).length
  )
  const subjectCount = Math.min(connectedSubjectCount + 1, MAX_SUBJECTS)
  const subjectSlots: SlotDef[] = Array.from({ length: subjectCount }, (_, i) => ({
    id: `subject-${i}`,
    label: `Subject ${i + 1}`,
    type: 'image' as const,
  }))

  useEffect(() => {
    updateNodeInternals(id)
  }, [subjectCount, id, updateNodeInternals])

  const [selectedModel, setSelectedModel] = useState(String(data.selected_model ?? 'gemini-3.1-flash-image-preview'))
  const [editMode, setEditMode] = useState(String(data.edit_mode ?? 'EDIT_MODE_DEFAULT'))
  const [maskMode, setMaskMode] = useState(String(data.mask_mode ?? 'MASK_MODE_BACKGROUND'))
  const [maskDilation, setMaskDilation] = useState(Number(data.mask_dilation ?? 0.01))
  const [aspectRatio, setAspectRatio] = useState(String(data.aspect_ratio ?? ''))
  const [numberOfImages, setNumberOfImages] = useState(Number(data.number_of_images ?? 1))
  const [localPrompt, setLocalPrompt] = useState(String(data.prompt ?? ''))
  const [resultB64, setResultB64] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()

  useEffect(() => { if (data._stop) { setLoading(false); setError('') } }, [data._stop])

  const needsMask = EDIT_MODES.find(m => m.value === editMode)?.needsMask ?? false

  const hasImageEdge = useStore(state =>
    state.edges.some(e => e.target === id && e.targetHandle === 'image-in')
  )

  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const prompt = localPrompt.trim()
      if (!prompt) { setError('Write an edit prompt'); return }

      const baseResult = await pullMedia(id, 'image-in', getNodes, getEdges)
      if (!baseResult.file) { setError('Connect an image to the Image input'); return }
      const baseFile = baseResult.file

      const subjects = await pullAllMedia(id, 'subject-', getNodes, getEdges)

      const r = await api.editImage(
        prompt, baseFile, selectedModel, apiKey, editMode, maskMode, maskDilation,
        numberOfImages, aspectRatio || undefined, subjects.length > 0 ? subjects : undefined,
      )
      if (!r.images_b64 || r.images_b64.length === 0) {
        throw new Error(r.status || 'No images generated')
      }

      const b64 = r.images_b64[0]
      setResultB64(b64)

      const mediaId = generateMediaId()
      const response = await fetch(`data:image/png;base64,${b64}`)
      const blob = await response.blob()
      const file = new File([blob], `edited_${Date.now()}.png`, { type: 'image/png' })
      await saveMediaForProject(mediaId, file)
      updateNodeData(id, { mediaId })

      // Model-aware fallback: estimate per-image cost for the selected model.
      // Models absent from MODEL_PRICING (e.g. imagen-3.0-capability-001) yield
      // 0 — keep the 0.02 generic floor for those so the entry isn't free.
      const fallback = estimateCost(
        selectedModel, 'generate_image', prompt, subjects.length,
      )
      const costUsd = r.usage?.cost_usd ?? (fallback.costUsd || 0.02)
      setLastCost(costUsd)
      useCanvasStore.getState().addCost({
        timestamp: new Date().toISOString(),
        nodeId: id,
        nodeName: 'Image Edit',
        model: selectedModel,
        inputTokens: fallback.inputTokens,
        outputTokens: fallback.outputTokens,
        costUsd,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    } finally {
      setLoading(false)
    }
  }, [localPrompt, selectedModel, editMode, maskMode, maskDilation, aspectRatio, numberOfImages, id, getNodes, getEdges, updateNodeData])

  return {
    selectedModel, setSelectedModel,
    editMode, setEditMode,
    maskMode, setMaskMode,
    maskDilation, setMaskDilation,
    aspectRatio, setAspectRatio,
    numberOfImages, setNumberOfImages,
    localPrompt, setLocalPrompt,
    resultB64,
    loading, error, lastCost,
    needsMask,
    hasImageEdge,
    subjectSlots,
    connectedSubjectCount,
    run,
    updateNodeData,
  }
}
