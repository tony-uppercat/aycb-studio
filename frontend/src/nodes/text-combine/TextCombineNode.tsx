import { useEffect, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import { NodeShell, type SlotDef } from '../_shared/NodeShell'
import { ExpandableText } from '../_shared/ExpandableText'
import { pullText } from '../../hooks/useDataPropagation'
import { isCascadeRunning } from '../../utils/cascadeRun'
import type { TextCombineNodeData } from '../../types'
import { colorizeJson } from '../../utils/jsonColorize'
import styles from '../_shared/Node.module.css'

type TextCombineNodeType = Node<TextCombineNodeData, 'textCombine'>

const MAX_INPUTS = 8

const SEPARATOR_OPTIONS = [
  { label: 'Newline', value: '\n' },
  { label: 'Space', value: ' ' },
  { label: 'Comma', value: ', ' },
  { label: 'Double newline', value: '\n\n' },
  { label: 'Custom', value: '__custom__' },
] as const

function isValidJson(text: string): boolean {
  try { JSON.parse(text); return true } catch { return false }
}

export function TextCombineNode({ id, data, selected }: NodeProps<TextCombineNodeType>) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

  // Dynamic pin count based on connected edges.
  // During cascade, pin count must never decrease (high-water mark)
  // to prevent React Flow from removing edges to vanished handles.
  const connectedCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('text-')).length
  )
  const rawPinCount = Math.min(connectedCount + 1, MAX_INPUTS)
  const [pinCount, setPinCount] = useState(rawPinCount)
  if (isCascadeRunning()) {
    // Only allow growth during cascade, never shrink
    if (rawPinCount > pinCount) setPinCount(rawPinCount)
  } else if (pinCount !== rawPinCount) {
    // Outside cascade, follow the live edge count
    setPinCount(rawPinCount)
  }

  // Subscribe to upstream data changes to trigger re-render
  useStore(state => {
    const edges = state.edges.filter(e => e.target === id)
    return edges.map(e => {
      const src = state.nodes.find(n => n.id === e.source)
      const d = src?.data as Record<string, unknown> | undefined
      return `${e.source}:${e.targetHandle}:${String(d?.outputText ?? '')}`
    }).join('|')
  })

  // Notify React Flow when pin count changes
  useEffect(() => {
    updateNodeInternals(id)
  }, [pinCount, id, updateNodeInternals])

  const [separatorMode, setSeparatorMode] = useState(() => {
    const saved = typeof data.separator === 'string' ? data.separator : '\n'
    const match = SEPARATOR_OPTIONS.find(o => o.value === saved)
    return match ? saved : '__custom__'
  })
  const [customSeparator, setCustomSeparator] = useState(() => {
    const saved = typeof data.separator === 'string' ? data.separator : '\n'
    const match = SEPARATOR_OPTIONS.find(o => o.value === saved)
    return match ? '' : saved
  })

  const separator = separatorMode === '__custom__' ? customSeparator : separatorMode

  // Collect texts from all connected pins
  const texts: string[] = []
  for (let i = 0; i < pinCount; i++) {
    const t = pullText(id, `text-${i}`, getNodes, getEdges)
    if (t) texts.push(t)
  }

  const combined = texts.join(separator)

  // Auto-combine and propagate output whenever inputs or separator change
  useEffect(() => {
    updateNodeData(id, { outputText: combined, separator })
  }, [combined, separator, id, updateNodeData])

  // Build dynamic input slots
  const textSlots: SlotDef[] = Array.from({ length: pinCount }, (_, i) => ({
    id: `text-${i}`,
    label: `Text ${i + 1}`,
    type: 'text' as const,
  }))

  const jsonMode = isValidJson(combined)

  return (
    <NodeShell
      name="Text Combine"
      selected={selected}
      icon="🔗"
      inputSlots={textSlots}
      outputSlots={[{ id: 'text-out', label: 'Output', type: 'text' }]}
    >
      <div className={styles.nodeContent}>
        <div className={styles.row} style={{ flexWrap: 'wrap' }}>
          {SEPARATOR_OPTIONS.map(o => (
            <button
              key={o.value}
              className={`${styles.toggleBtn} ${separatorMode === o.value ? styles.toggleActive : ''}`}
              onClick={() => {
                setSeparatorMode(o.value)
                if (o.value !== '__custom__') {
                  updateNodeData(id, { separator: o.value })
                }
              }}
              style={{ fontSize: 10, padding: '3px 8px' }}
            >
              {o.label}
            </button>
          ))}
        </div>

        {separatorMode === '__custom__' && (
          <input
            className={styles.promptInput}
            style={{ minHeight: 'unset', flex: 'none' }}
            type="text"
            placeholder="Custom separator..."
            value={customSeparator}
            onChange={e => {
              setCustomSeparator(e.target.value)
              updateNodeData(id, { separator: e.target.value })
            }}
          />
        )}

        <p className={styles.infoBadge}>
          {texts.length === 0
            ? 'Connect text inputs...'
            : `${texts.length} input${texts.length !== 1 ? 's' : ''} combined (${combined.length} chars)`
          }
        </p>

        {combined ? (
          jsonMode ? (
            <pre
              className={styles.resultArea}
              style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              dangerouslySetInnerHTML={{ __html: colorizeJson(combined) }}
            />
          ) : (
            <ExpandableText value={combined} rows={6} placeholder="Output will appear here..." />
          )
        ) : (
          <ExpandableText value="" rows={4} placeholder="Connect text inputs to combine..." />
        )}
      </div>
    </NodeShell>
  )
}

export default TextCombineNode
