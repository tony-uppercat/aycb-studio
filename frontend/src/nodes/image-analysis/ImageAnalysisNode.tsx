import { useCallback, useEffect, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { ExpandableText } from '../_shared/ExpandableText'
import { useSettings } from '../../components/SettingsContext'
import { useFileDrop } from '../../hooks/useFileDrop'
import { api } from '../../api'
import { pullMedia } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { estimateCost, formatCostEstimate } from '../../utils/costEstimate'
import { useCanvasStore } from '../../stores/canvasStore'
import type { ImageAnalysisNodeData, AnalyzeImageResult } from '../../types'
import { useMediaPreview } from '../../components/media/MediaPreview'
import styles from '../_shared/Node.module.css'

export function ImageAnalysisNode({ id, data, selected }: NodeProps) {
  const { openPreview } = useMediaPreview()
  const d = data as ImageAnalysisNodeData
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { apiKey, model, doEmbed } = useSettings()

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()

  const estimate = estimateCost(model, 'analyze_image', '', file ? 1 : 0)
  const estimatedLabel = formatCostEstimate(estimate.costUsd)

  useEffect(() => { if (d._stop) { setLoading(false); setError('') } }, [d._stop])

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview) }
  }, [preview])

  const pickFile = useCallback(
    (f: File) => {
      setFile(f)
      if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(f))
      setError('')
    },
    [preview],
  )

  const { dragging, inputRef, dragHandlers, onInputChange, openPicker } =
    useFileDrop('image/', pickFile)

  const run = useCallback(async () => {
    const { file: pulledFile } = await pullMedia(id, 'image-in', getNodes, getEdges)
    const imageFile = pulledFile ?? file
    if (!imageFile) { setError('Upload an image or connect an Image pin'); return }
    setLoading(true)
    setError('')
    try {
      const r: AnalyzeImageResult = await api.analyzeImage(imageFile, model, doEmbed, apiKey)
      setPreview('data:image/png;base64,' + r.preview_b64)
      updateNodeData(id, { text: r.text, outputText: r.text, json: r.json, result: r })
      // Track cost from API response or fall back to client-side estimate
      const fallback = estimateCost(model, 'analyze_image', '', 1)
      const costUsd = r.usage?.cost_usd ?? fallback.costUsd
      setLastCost(costUsd)
      useCanvasStore.getState().addCost({
        timestamp: new Date().toISOString(),
        nodeId: id,
        nodeName: 'Image Analysis',
        model: model,
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
  }, [file, apiKey, model, doEmbed, id, updateNodeData, getNodes, getEdges])

  function handlePreviewClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (preview) openPreview(preview, 'image')
  }

  return (
    <NodeShell
      name="Image Analysis"
      selected={selected}
      icon="🖼"
      inputSlots={[
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
        { id: 'image-in', label: 'Image', type: 'image', required: true },
      ]}
      outputSlots={[
        { id: 'text-out', label: 'Text', type: 'text' },
        { id: 'json-out', label: 'JSON', type: 'text' },
      ]}
      onRun={run}
      running={loading}
      lastCost={lastCost}
      estimatedCost={estimatedLabel}
    >
      <div className={styles.nodeContent}>
        <div
          className={styles.previewArea}
          onClick={openPicker}
          {...dragHandlers}
          style={dragging ? { borderColor: '#3b82f6' } : undefined}
        >
          {preview
            ? (
              <img
                src={preview}
                alt="preview"
                className={styles.previewImg}
                onClick={handlePreviewClick}
                style={{ cursor: 'pointer' }}
              />
            )
            : <span className={styles.dropHint}>Click or drag an image</span>}
        </div>
        <input ref={inputRef} type="file" accept="image/*" className={styles.hidden}
          onChange={onInputChange} />
        {error && <p className={styles.error}>{error}</p>}
        {typeof d.text === 'string' && d.text && (
          <ExpandableText value={d.text} rows={4} />
        )}
      </div>
    </NodeShell>
  )
}

export default ImageAnalysisNode
