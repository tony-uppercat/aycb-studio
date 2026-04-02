import { useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { CopyButton } from '../../components/ui/CopyButton'
import { ExpandableText } from '../_shared/ExpandableText'
import { pullText } from '../../hooks/useDataPropagation'
import type { ResultViewerNodeData } from '../../types'
import styles from '../_shared/Node.module.css'

export function ResultViewerNode({ id, data, selected }: NodeProps) {
  const d = data as ResultViewerNodeData
  const { updateNodeData, getNodes, getEdges } = useReactFlow()

  // Re-render when upstream data changes
  useStore(state => {
    const edges = state.edges.filter(e => e.target === id)
    return edges.map(e => {
      const src = state.nodes.find(n => n.id === e.source)
      return String((src?.data as Record<string, unknown>)?.outputText ?? '')
    }).join('|')
  })

  const text = pullText(id, 'text-in', getNodes, getEdges) || (d.text ?? '')
  const jsonStr = pullText(id, 'json-in', getNodes, getEdges) || (d.json ? JSON.stringify(d.json, null, 2) : (d.json_text ?? ''))

  function handleRun() {
    const freshText = pullText(id, 'text-in', getNodes, getEdges)
    const freshJson = pullText(id, 'json-in', getNodes, getEdges)
    updateNodeData(id, { text: freshText, outputText: freshText, json_text: freshJson })
  }

  return (
    <NodeShell
      name="Result Viewer"
      selected={selected}
      icon="📄"
      onRun={handleRun}
      inputSlots={[
        { id: 'text-in', label: 'Text', type: 'text' },
        { id: 'json-in', label: 'JSON', type: 'text' },
      ]}
      outputSlots={[
        { id: 'text-out', label: 'Text', type: 'text' },
      ]}
    >
      <div className={styles.nodeContent}>
        <div>
          <div className={styles.row}>
            <span className={styles.label}>Text</span>
            {text && <CopyButton text={text} />}
          </div>
          <ExpandableText value={text} rows={5} onEdit={(t) => updateNodeData(id, { text: t, outputText: t })} />
        </div>
        <div>
          <div className={styles.row}>
            <span className={styles.label}>JSON</span>
            {jsonStr && <CopyButton text={jsonStr} />}
          </div>
          <ExpandableText value={jsonStr} rows={5} onEdit={(t) => updateNodeData(id, { json_text: t })} />
        </div>
      </div>
    </NodeShell>
  )
}

export default ResultViewerNode
