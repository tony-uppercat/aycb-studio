import { useEffect, useState } from 'react'
import { useReactFlow, useStore, type Node, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import type { SwitchNodeData } from '../../types'
import styles from '../_shared/Node.module.css'

type SwitchNodeType = Node<SwitchNodeData, 'switch'>

// SOH delimiter — never present in user text — joins inputs into a primitive
// so useStore's default reference equality short-circuits subsequent renders.
const SEP = String.fromCharCode(1)

export function SwitchNode({ id, data, selected }: NodeProps<SwitchNodeType>) {
  const { updateNodeData } = useReactFlow()

  // Returning a fresh array here would re-render on every store change and
  // trip the useEffect below into an infinite updateNodeData loop. A stable
  // string lets useStore bail out unless the actual text content changed.
  const textsKey = useStore(state => {
    const edges = state.edges.filter(e => e.target === id && e.targetHandle === 'text-in')
    return edges.map(e => {
      const src = state.nodes.find(n => n.id === e.source)
      const d = src?.data as Record<string, unknown> | undefined
      return String(d?.outputText ?? d?.text ?? d?.prompt ?? '')
    }).join(SEP)
  })

  const texts = textsKey ? textsKey.split(SEP) : []
  const count = texts.length
  const [active, setActive] = useState(data.activeChannel ?? 0)
  const clamped = count > 0 ? Math.min(active, count - 1) : 0

  useEffect(() => {
    const list = textsKey ? textsKey.split(SEP) : []
    const text = list[clamped] ?? ''
    updateNodeData(id, { outputText: text, activeChannel: clamped })
  }, [clamped, textsKey, id, updateNodeData])

  return (
    <NodeShell name="Switch" selected={selected} icon="⇄"
      inputSlots={[{ id: 'text-in', label: 'In', type: 'text' }]}
      outputSlots={[{ id: 'text-out', label: 'Out', type: 'text' }]}
    >
      <div className={styles.nodeContent}>
        <div
          className={styles.switchDisplay}
          onWheel={(e) => {
            e.stopPropagation()
            if (e.deltaY > 0) setActive(a => Math.min(count - 1, a + 1))
            else setActive(a => Math.max(0, a - 1))
          }}
        >
          <button className={styles.switchArrow} onClick={() => setActive(a => Math.max(0, a - 1))} disabled={clamped <= 0}>‹</button>
          <div className={styles.switchChannel}>{count > 0 ? clamped + 1 : 0}</div>
          <button className={styles.switchArrow} onClick={() => setActive(a => Math.min(count - 1, a + 1))} disabled={clamped >= count - 1}>›</button>
        </div>
      </div>
    </NodeShell>
  )
}

export default SwitchNode
