import { memo, useCallback, useEffect, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import { NodeShell, type SlotDef } from '../_shared/NodeShell'
import { priceTier } from '../_shared/types'
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
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', api: 'gemini', tooltip: 'Ultra fast & cheap, default minimal thinking', price: '$0.25/$1.50', cost: 0.25, deprecated: false },
  { id: 'gemini-3.1-flash-lite:thinking', name: 'Gemini 3.1 Flash-Lite Thinking', api: 'gemini', tooltip: 'Flash-Lite with thinking forced to high', price: '$0.25/$1.50', cost: 0.25, deprecated: false },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', api: 'gemini', tooltip: 'Latest, thinking always on, advanced agentic reasoning', price: '$2/$12', cost: 2, deprecated: false },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', api: 'gemini', tooltip: '1M context, fast balanced performance, multimodal', price: '$0.50/$3', cost: 0.50, deprecated: false },
  { id: 'gemini-3-flash-preview:thinking', name: 'Gemini 3 Flash Thinking', api: 'gemini', tooltip: 'Gemini 3 Flash with high thinking level', price: '$0.50/$3', cost: 0.50, deprecated: false },
  { id: 'claude-sonnet-4-6-20250620', name: 'Claude Sonnet 4.6', api: 'anthropic', tooltip: 'Strong all-around model with excellent coding and analysis', price: '$3/$15', cost: 3, deprecated: false },
  { id: 'claude-opus-4-6-20250620', name: 'Claude Opus 4.6', api: 'anthropic', tooltip: 'Most capable Claude model for advanced reasoning and creativity', price: '$15/$75', cost: 15, deprecated: false },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', api: 'anthropic', tooltip: 'Fast and cost-effective for lightweight tasks', price: '$0.80/$4', cost: 0.80, deprecated: false },
  { id: 'cli-claude-opus-4-8', name: 'Opus 4.8 (Local CLI)', api: 'claude-cli', tooltip: 'Runs via the local claude CLI — subscription auth, no API key', price: 'sub', cost: 0, deprecated: false },
  { id: 'cli-claude-opus-4-6', name: 'Opus 4.6 (Local CLI)', api: 'claude-cli', tooltip: 'Runs via the local claude CLI — subscription auth, no API key', price: 'sub', cost: 0, deprecated: false },
  { id: 'cli-claude-sonnet-4-6', name: 'Sonnet 4.6 (Local CLI)', api: 'claude-cli', tooltip: 'Runs via the local claude CLI — subscription auth, no API key', price: 'sub', cost: 0, deprecated: false },
] as const


const MAX_MEDIA = 8

export function LLMNode({ id, data, selected }: NodeProps<LLMNodeType>) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { apiKey, anthropicKey } = useSettings()
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
  const [localSystemPrompt, setLocalSystemPrompt] = useState(
    typeof data.systemPrompt === 'string' ? data.systemPrompt : ''
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

    const systemPin = pullText(id, 'text-system', getNodes, getEdges)
    const systemPrompt = systemPin.trim() || localSystemPrompt.trim()

    setLoading(true); setError('')

    const files = await pullAllMedia(id, 'media-', getNodes, getEdges)

    try {
      const effectiveKey =
        modelInfo.api === 'anthropic' ? (anthropicKey || '')
        : modelInfo.api === 'claude-cli' ? ''
        : (apiKey || '')
      const r = await api.llmChat(prompt, modelInfo.id, effectiveKey, files.length ? files : undefined, systemPrompt)
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
  }, [apiKey, anthropicKey, modelInfo, selectedModel, showThinking, localPrompt, prependMode, id, getNodes, getEdges, updateNodeData])

  const inputSlots: SlotDef[] = [
    { id: 'text-system', label: 'System', type: 'text' },
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
          className={`${styles.select} ${modelInfo && 'cost' in modelInfo ? styles[priceTier(modelInfo.cost, 1, 5)] : ''}`}
          value={selectedModel}
          onChange={e => {
            setSelectedModel(e.target.value)
            updateNodeData(id, { selectedModel: e.target.value })
          }}
        >
          {[
            { label: 'Gemini (Google)', items: LLM_MODELS.filter(m => m.api === 'gemini') },
            { label: 'Claude (Anthropic)', items: LLM_MODELS.filter(m => m.api === 'anthropic') },
            { label: 'Claude (Local CLI)', items: LLM_MODELS.filter(m => m.api === 'claude-cli') },
          ].map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map(m => (
                <option key={m.id} value={m.id} title={m.tooltip}>{m.name} ({m.price})</option>
              ))}
            </optgroup>
          ))}
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
        {/* System prompt — shown when no text-system pin connected */}
        {!pullText(id, 'text-system', getNodes, getEdges).trim() && (
          <textarea
            className={`${styles.promptTextarea} nodrag nowheel nokey`}
            value={localSystemPrompt}
            onChange={e => {
              setLocalSystemPrompt(e.target.value)
              updateNodeData(id, { systemPrompt: e.target.value })
            }}
            rows={1}
            placeholder="System prompt (optional)"
            style={{ fontSize: 10, opacity: 0.7, minHeight: 22 }}
          />
        )}
        <textarea
          className={styles.promptTextarea}
          value={localPrompt}
          onChange={e => {
            setLocalPrompt(e.target.value)
            updateNodeData(id, { prompt: e.target.value })
          }}
          rows={3}
          placeholder="Prompt..."
        />
        {error && <p className={styles.error}>{error}</p>}
        <ExpandableText value={displayOutput} rows={6} placeholder="Output appears here..." onEdit={(text) => { setOutput(text); updateNodeData(id, { outputText: text, text }) }} />
      </div>
    </NodeShell>
  )
}

export default memo(LLMNode)
