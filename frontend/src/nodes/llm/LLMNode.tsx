import { memo, useCallback, useEffect, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import { NodeShell, type SlotDef } from '../_shared/NodeShell'
import { ExpandableText } from '../_shared/ExpandableText'
import { useSettings } from '../../components/SettingsContext'
import { api } from '../../api'
import { pullText, pullAllMedia } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'
import { estimateCost, formatCostEstimate } from '../../utils/costEstimate'
import { useCanvasStore } from '../../stores/canvasStore'
import { useOllamaModels } from '../../hooks/useOllamaModels'
import type { LLMNodeData } from '../../types'
import styles from '../_shared/Node.module.css'

type LLMNodeType = Node<LLMNodeData, 'llm'>

const LLM_MODELS = [
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash-Lite', api: 'gemini', tooltip: 'Ultra fast & cheap, $0.25/1M input, thinking support', deprecated: false },
  { id: 'gemini-3.1-flash-lite-preview:thinking', name: 'Gemini 3.1 Flash-Lite Thinking', api: 'gemini', tooltip: '3.1 Flash-Lite with high thinking level', deprecated: false },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', api: 'gemini', tooltip: 'Latest, thinking always on, advanced agentic reasoning', deprecated: false },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', api: 'gemini', tooltip: '1M context, fast balanced performance, multimodal', deprecated: false },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', api: 'gemini', tooltip: '1M context, complex reasoning, coding, research', deprecated: false },
  { id: 'gemini-3-flash-preview:thinking', name: 'Gemini 3 Flash Thinking', api: 'gemini', tooltip: 'Gemini 3 Flash with high thinking level', deprecated: false },
  { id: 'gemini-2.5-flash:thinking', name: 'Gemini 2.5 Flash Thinking', api: 'gemini', tooltip: 'LEGACY — Extended thinking mode. Consider 3.x Flash Thinking instead.', deprecated: true },
  { id: 'gemini-2.5-pro:thinking', name: 'Gemini 2.5 Pro Thinking', api: 'gemini', tooltip: 'LEGACY — Deep reasoning. Consider 3.x Pro instead.', deprecated: true },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', api: 'gemini', tooltip: 'LEGACY — Previous gen. Consider 3.x Flash instead.', deprecated: true },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', api: 'gemini', tooltip: 'LEGACY — Previous gen. Consider 3.x Pro instead.', deprecated: true },
  { id: 'claude-sonnet-4-6-20250620', name: 'Claude Sonnet 4.6', api: 'anthropic', tooltip: 'Strong all-around model with excellent coding and analysis', deprecated: false },
  { id: 'claude-opus-4-6-20250620', name: 'Claude Opus 4.6', api: 'anthropic', tooltip: 'Most capable Claude model for advanced reasoning and creativity', deprecated: false },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', api: 'anthropic', tooltip: 'Fast and cost-effective for lightweight tasks', deprecated: false },
] as const

const MAX_MEDIA = 8

export function LLMNode({ id, data, selected }: NodeProps<LLMNodeType>) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { apiKey } = useSettings()
  const { models: ollamaModels, available: ollamaAvailable } = useOllamaModels()

  const connectedMediaCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('media-')).length
  )

  const mediaCount = Math.min(connectedMediaCount + 1, MAX_MEDIA)
  const mediaSlots: SlotDef[] = Array.from({ length: mediaCount }, (_, i) => ({
    id: `media-${i}`,
    label: `Media ${i + 1}`,
    type: 'media' as const,
  }))

  useEffect(() => {
    updateNodeInternals(id)
  }, [mediaCount, id, updateNodeInternals])

  const [selectedModel, setSelectedModel] = useState(
    typeof data.selectedModel === 'string' ? data.selectedModel : LLM_MODELS[0].id
  )
  const [output, setOutput] = useState(
    typeof data.outputText === 'string' ? data.outputText
    : typeof data.text === 'string' ? data.text : ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lastCost, setLastCost] = useState<number | undefined>()
  const [showThinking, setShowThinking] = useState(
    typeof data.showThinking === 'boolean' ? data.showThinking : false
  )
  const [localPrompt, setLocalPrompt] = useState(
    typeof data.prompt === 'string' ? data.prompt : ''
  )
  const [prependMode, setPrependMode] = useState(
    typeof data.prependPrompt === 'boolean' ? data.prependPrompt : true
  )

  useEffect(() => { if (data._stop) { setLoading(false); setError('') } }, [data._stop])

  // Sync local state when node data changes externally (import, undo, etc.)
  useEffect(() => {
    const incoming = typeof data.outputText === 'string' ? data.outputText
                   : typeof data.text === 'string' ? data.text : null
    if (incoming != null && incoming !== output) setOutput(incoming)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.outputText, data.text])

  const isThinkingModel = selectedModel.includes(':thinking') || selectedModel.includes('3.1-pro')

  // Strip <thinking>...</thinking> tags from output when toggle is off
  const displayOutput = !showThinking && output.includes('<thinking>')
    ? output.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim()
    : output

  const modelInfo = LLM_MODELS.find(m => m.id === selectedModel)
    ?? ollamaModels.find(m => m.id === selectedModel)
    ?? LLM_MODELS[0]

  // Live cost estimate based on current prompt
  const pinText = pullText(id, 'prompt-in', getNodes, getEdges)
  const effectivePrompt = pinText.trim()
    ? (prependMode && localPrompt.trim() ? `${localPrompt}\n\n${pinText}` : pinText)
    : localPrompt
  const estimate = estimateCost(selectedModel, 'llm_chat', effectivePrompt, connectedMediaCount)
  const estimatedLabel = formatCostEstimate(estimate.costUsd)

  const run = useCallback(async () => {
    const pin = pullText(id, 'prompt-in', getNodes, getEdges)
    const prompt = pin.trim()
      ? (prependMode && localPrompt.trim() ? `${localPrompt}\n\n${pin}` : pin)
      : localPrompt
    if (!prompt.trim()) { setError('Write a prompt or connect a Prompt pin'); return }
    setLoading(true); setError('')

    const files = await pullAllMedia(id, 'media-', getNodes, getEdges)

    try {
      const r = await api.llmChat(prompt, modelInfo.id, apiKey || '', files.length ? files : undefined)
      const text = r.text || ''
      setOutput(text)
      // Propagate filtered output (without thinking) to downstream nodes
      const filtered = text.includes('<thinking>')
        ? text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim()
        : text
      updateNodeData(id, { outputText: filtered, text, selectedModel, showThinking })
      // Track cost from API response or fall back to client-side estimate
      const fallback = estimateCost(selectedModel, 'llm_chat', prompt, files.length)
      const costUsd = r.usage?.cost_usd ?? fallback.costUsd
      setLastCost(costUsd)
      useCanvasStore.getState().addCost({
        timestamp: new Date().toISOString(),
        nodeId: id,
        nodeName: 'LLM',
        model: modelInfo.name,
        inputTokens: r.usage?.input_tokens ?? fallback.inputTokens,
        outputTokens: r.usage?.output_tokens ?? fallback.outputTokens,
        costUsd,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    }
    finally { setLoading(false) }
  }, [apiKey, modelInfo, selectedModel, showThinking, localPrompt, prependMode, id, getNodes, getEdges, updateNodeData])

  const inputSlots: SlotDef[] = [
    { id: 'prompt-in', label: 'Prompt', type: 'prompt' },
    ...mediaSlots,
  ]

  return (
    <NodeShell
      name="LLM"
      selected={selected}
      inputSlots={inputSlots}
      outputSlots={[
        { id: 'text-out', label: 'Text', type: 'text' },
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
          <optgroup label="Gemini (Google)">
            {LLM_MODELS.filter(m => m.api === 'gemini').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.deprecated ? '[LEGACY] ' : ''}{m.name}</option>
            ))}
          </optgroup>
          <optgroup label="Claude (Anthropic)">
            {LLM_MODELS.filter(m => m.api === 'anthropic').map(m => (
              <option key={m.id} value={m.id} title={m.tooltip}>{m.deprecated ? '[LEGACY] ' : ''}{m.name}</option>
            ))}
          </optgroup>
          {ollamaAvailable && ollamaModels.length > 0 && (
            <optgroup label="Ollama (Local)">
              {ollamaModels.map(m => (
                <option key={m.id} value={m.id} title={m.tooltip}>{m.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        {modelInfo.deprecated && (
          <div className={styles.deprecatedWarning}>Legacy model — consider switching to a 3.x version</div>
        )}
        {/* Prompt label + toggles row */}
        <div className={styles.row}>
          <span className={styles.label}>Prompt</span>
          {isThinkingModel && (
            <button
              className={`${styles.subtleToggle} ${showThinking ? styles.subtleToggleOn : ''}`}
              onClick={() => {
                setShowThinking(!showThinking)
                updateNodeData(id, { showThinking: !showThinking })
              }}
              title={showThinking ? 'Thinking visible' : 'Answer only'}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a9 9 0 0 0-9 9c0 3.9 2.5 7.2 6 8.4V21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.6c3.5-1.2 6-4.5 6-8.4a9 9 0 0 0-9-9zm-1 15h2v1h-2v-1zm3.5-4.2-.7.5c-.5.3-.8.7-.8 1.2V15h-2v-.5c0-.9.5-1.7 1.2-2.2l1-.7c.4-.3.6-.7.6-1.1 0-.8-.7-1.5-1.5-1.5H12c-.8 0-1.5.7-1.5 1.5H8.5A3.5 3.5 0 0 1 12 7h.3A3.5 3.5 0 0 1 15.8 10.5c0 .9-.4 1.7-1.3 2.3z"/></svg>
            </button>
          )}
          <button
            className={`${styles.subtleToggle} ${prependMode ? styles.subtleToggleOn : ''}`}
            onClick={() => {
              setPrependMode(!prependMode)
              updateNodeData(id, { prependPrompt: !prependMode })
            }}
            title={prependMode ? 'Prepend ON' : 'Prepend OFF'}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h12v2H3v-2z"/><path d="M19 15l-4-3v6l4-3z"/></svg>
          </button>
        </div>
        <textarea
          className={styles.promptTextarea}
          value={localPrompt}
          onChange={e => {
            setLocalPrompt(e.target.value)
            updateNodeData(id, { prompt: e.target.value })
          }}
          rows={3}
          placeholder="System prompt, instructions..."
        />
        {error && <p className={styles.error}>{error}</p>}
        <ExpandableText value={displayOutput} rows={6} placeholder="Output appears here..." onEdit={(text) => { setOutput(text); updateNodeData(id, { outputText: text, text }) }} />
      </div>
    </NodeShell>
  )
}

export default memo(LLMNode)
