import { useCallback, useEffect, useState } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { ExpandableText } from '../_shared/ExpandableText'
import { useSettings } from '../../components/SettingsContext'
import { api } from '../../api'
import { pullMedia, pullText } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { estimateCost, formatCostEstimate } from '../../utils/costEstimate'
import { useCanvasStore } from '../../stores/canvasStore'
import type { MetapromptNodeData } from '../../types'
import styles from '../_shared/Node.module.css'

// ── Models for overpaint analysis (vision-capable Gemini models) ─────────────

const METAPROMPT_MODELS = [
  { id: 'gemini-3.1-flash-lite-preview',           name: 'Gemini 3.1 Flash-Lite',        deprecated: false, tooltip: 'Ultra-fast & cheap' },
  { id: 'gemini-3.1-flash-lite-preview:thinking',  name: 'Gemini 3.1 Flash-Lite (Think)', deprecated: false, tooltip: 'Flash-Lite with deep reasoning' },
  { id: 'gemini-3.1-pro-preview',                  name: 'Gemini 3.1 Pro',               deprecated: false, tooltip: 'Latest, always-thinking' },
  { id: 'gemini-3-flash-preview',                  name: 'Gemini 3 Flash',               deprecated: false, tooltip: 'Fast, balanced, multimodal' },
  { id: 'gemini-3-flash-preview:thinking',         name: 'Gemini 3 Flash (Think)',        deprecated: false, tooltip: 'Flash with deep reasoning' },
] as const

// ── System prompt for overpaint analysis ─────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert art director's assistant. You are given two images:
1. The ORIGINAL image (first image)
2. The ANNOTATED/OVERPAINTED version (second image) — the art director drew on top of the original to indicate desired changes

Your job:
- Compare the two images carefully
- Identify every annotation, sketch, overpaint, arrow, circle, color region, text, or marking added in the annotated version
- Interpret what each annotation means as a creative direction (e.g., red arrow pointing at face = change expression, blue paint over sky = make sky more dramatic, crossed-out element = remove it, sketched shape = add this element)
- Generate a clear, detailed image generation prompt that describes the desired final result incorporating ALL the indicated changes

Output ONLY the generation prompt — no explanations, no bullet points, no prefixes. The prompt should be ready to feed directly into an image generation model.`

// ── Component ────────────────────────────────────────────────────────────────

export function MetapromptNode({ id, data, selected }: NodeProps) {
  const d = data as MetapromptNodeData
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { apiKey } = useSettings()

  const [selectedModel, setSelectedModel] = useState<string>(
    typeof d.selectedModel === 'string' ? d.selectedModel : METAPROMPT_MODELS[0].id
  )
  const [output, setOutput] = useState(
    typeof d.outputText === 'string' ? d.outputText : ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()

  useEffect(() => { if (d._stop) { setLoading(false); setError('') } }, [d._stop])

  // Sync local state when node data changes externally (import, undo, etc.)
  useEffect(() => {
    const incoming = typeof d.outputText === 'string' ? d.outputText : null
    if (incoming != null && incoming !== output) setOutput(incoming)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.outputText])

  const modelInfo = METAPROMPT_MODELS.find(m => m.id === selectedModel) ?? METAPROMPT_MODELS[0]

  const estimate = estimateCost(selectedModel, 'llm_chat', SYSTEM_PROMPT, 2)
  const estimatedLabel = formatCostEstimate(estimate.costUsd)

  const run = useCallback(async () => {
    // Pull both images: original + overpainted
    const { file: originalFile } = await pullMedia(id, 'image-0', getNodes, getEdges)
    const { file: overpaintFile } = await pullMedia(id, 'image-1', getNodes, getEdges)

    if (!originalFile || !overpaintFile) {
      setError('Connect both Original and Overpainted image pins')
      return
    }

    // Pull optional context/instructions
    const contextPrompt = pullText(id, 'prompt-in', getNodes, getEdges)
    const fullPrompt = contextPrompt
      ? `${SYSTEM_PROMPT}\n\nAdditional context from the art director:\n${contextPrompt}`
      : SYSTEM_PROMPT

    setLoading(true)
    setError('')
    try {
      const r = await api.llmChat(fullPrompt, modelInfo.id, apiKey || '', [originalFile, overpaintFile])
      const text = r.text || ''
      // Strip thinking tags if present
      const filtered = text.includes('<thinking>')
        ? text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim()
        : text
      setOutput(filtered)
      updateNodeData(id, { outputText: filtered, text: filtered, selectedModel })

      // Track cost
      const fallback = estimateCost(selectedModel, 'llm_chat', fullPrompt, 2)
      const costUsd = r.usage?.cost_usd ?? fallback.costUsd
      setLastCost(costUsd)
      useCanvasStore.getState().addCost({
        timestamp: new Date().toISOString(),
        nodeId: id,
        nodeName: 'Metaprompt',
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
  }, [id, apiKey, modelInfo, selectedModel, getNodes, getEdges, updateNodeData])

  return (
    <NodeShell
      name="Metaprompt"
      icon="🎯"
      selected={selected}
      inputSlots={[
        { id: 'image-0', label: 'Original', type: 'image', required: true },
        { id: 'image-1', label: 'Overpaint', type: 'image', required: true },
        { id: 'prompt-in', label: 'Context', type: 'prompt' },
      ]}
      outputSlots={[
        { id: 'text-out', label: 'Prompt', type: 'text' },
      ]}
      onRun={run}
      running={loading}
      lastCost={lastCost}
      estimatedCost={estimatedLabel}
    >
      <div className={styles.nodeContent}>
        <select
          className={`${styles.select} ${modelInfo.deprecated ? styles.selectDeprecated : ''}`}
          value={selectedModel}
          onChange={e => {
            setSelectedModel(e.target.value)
            updateNodeData(id, { selectedModel: e.target.value })
          }}
        >
          {METAPROMPT_MODELS.map(m => (
            <option key={m.id} value={m.id} title={m.tooltip}>
              {m.deprecated ? '[LEGACY] ' : ''}{m.name}
            </option>
          ))}
        </select>
        {error && <p className={styles.error}>{error}</p>}
        <ExpandableText
          value={output}
          rows={6}
          placeholder="Connect Original + Overpainted images and click Run"
          onEdit={(text) => { setOutput(text); updateNodeData(id, { outputText: text, text }) }}
        />
      </div>
    </NodeShell>
  )
}

export default MetapromptNode
