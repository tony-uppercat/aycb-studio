import { useCallback, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { ExpandableText } from '../_shared/ExpandableText'
import { useSettings } from '../../components/SettingsContext'
import { api } from '../../api'
import { pullMedia, pullText } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { estimateCost, formatCostEstimate } from '../../utils/costEstimate'
import { resolveModel } from '../../providers/geminiProvider'
import { useCanvasStore } from '../../stores/canvasStore'
import styles from '../_shared/Node.module.css'

const DEFAULT_PROMPT =
  'Compare these two images in detail. Describe similarities and differences in composition, colors, subjects, style, and quality. Output as structured JSON with keys: similarities, differences, verdict.'

export function ComparisonNode({ id, data, selected }: NodeProps) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { apiKey, model } = useSettings()

  const [output, setOutput] = useState((data as Record<string, unknown>).outputText as string || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()

  const modelId = resolveModel(model)
  const estimate = estimateCost(modelId, 'llm_chat', DEFAULT_PROMPT, 2)
  const estimatedLabel = formatCostEstimate(estimate.costUsd)

  const run = useCallback(async () => {
    // Pull both images
    const { file: file1 } = await pullMedia(id, 'image-0', getNodes, getEdges)
    const { file: file2 } = await pullMedia(id, 'image-1', getNodes, getEdges)

    if (!file1 || !file2) {
      setError('Connect both Image A and Image B pins')
      return
    }

    // Pull optional prompt override
    const customPrompt = pullText(id, 'prompt-in', getNodes, getEdges)
    const prompt = customPrompt || DEFAULT_PROMPT

    setLoading(true)
    setError('')
    try {
      const r = await api.llmChat(prompt, model, apiKey, [file1, file2])
      const text = r.text || ''
      setOutput(text)
      updateNodeData(id, { outputText: text, text })

      // Track cost from API response or fall back to client-side estimate
      const fallback = estimateCost(modelId, 'llm_chat', prompt, 2)
      const costUsd = r.usage?.cost_usd ?? fallback.costUsd
      setLastCost(costUsd)
      useCanvasStore.getState().addCost({
        timestamp: new Date().toISOString(),
        nodeId: id,
        nodeName: 'Comparison',
        model: modelId,
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
  }, [id, apiKey, model, getNodes, getEdges, updateNodeData])

  return (
    <NodeShell
      name="LLM Compare"
      icon="⚖️"
      selected={selected}
      inputSlots={[
        { id: 'image-0', label: 'Image A', type: 'image', required: true },
        { id: 'image-1', label: 'Image B', type: 'image', required: true },
        { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
      ]}
      outputSlots={[
        { id: 'text-out', label: 'Result', type: 'text' },
      ]}
      onRun={run}
      running={loading}
      lastCost={lastCost}
      estimatedCost={estimatedLabel}
    >
      <div className={styles.nodeContent}>
        {error && <p className={styles.error}>{error}</p>}
        <ExpandableText value={output} rows={6} placeholder="Connect two images and click ▶ Run" onEdit={(text) => { setOutput(text); updateNodeData(id, { outputText: text, text }) }} />
      </div>
    </NodeShell>
  )
}

export default ComparisonNode
