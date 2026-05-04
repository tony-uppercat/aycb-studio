import { memo, useCallback, useEffect, useState } from 'react'
import { useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import type { SlotType } from '../_shared/types'
import { toSnakeCase, pullBySlotType } from '../subnet/subnetUtils'
import { registerNodeRun, unregisterNodeRun } from '../../utils/cascadeRun'
import styles from '../_shared/Node.module.css'

export interface SubnetOutputNodeData {
  handle_id: string
  name: string
  slot_type: SlotType
  result?: unknown
  [key: string]: unknown
}

/**
 * Pure onRun builder for subnet-output.
 *
 * Reads the value connected to the 'in' handle (text/media based on slot_type)
 * and writes it into `data.result` via updateNodeData.
 *
 * Exported so it can be unit-tested without mounting the component.
 *
 * At the subnet level, `getNodes()`/`getEdges()` return the ACTIVE sub_graph's
 * nodes/edges — the output proxy reads from a sibling internal node.
 */
export function buildOutputOnRun(
  id: string,
  getData: () => SubnetOutputNodeData,
  getNodes: () => Node[],
  getEdges: () => Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): () => Promise<void> {
  return async () => {
    const d = getData()
    const slotType = d.slot_type || 'text'
    const value = await pullBySlotType(slotType, id, 'in', getNodes, getEdges)
    updateNodeData(id, { result: value })
  }
}

function SubnetOutputNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as SubnetOutputNodeData
  const { updateNodeData, getNodes, getEdges } = useReactFlow()

  // Local draft so the user can type freely; committed to snake_case on blur.
  const [draft, setDraft] = useState(d.name ?? '')
  useEffect(() => {
    setDraft(d.name ?? '')
  }, [d.name])

  const commitRename = useCallback(() => {
    const snake = toSnakeCase(draft) || 'output'
    if (snake !== d.name) updateNodeData(id, { name: snake })
  }, [draft, d.name, id, updateNodeData])

  const handleSlotTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateNodeData(id, { slot_type: e.target.value as SlotType })
    },
    [id, updateNodeData]
  )

  // Build onRun using the pure helper. getData reads the live node data
  // at invocation time so it always sees the current slot_type.
  const onRun = useCallback(
    buildOutputOnRun(
      id,
      () => {
        const node = getNodes().find(n => n.id === id)
        return (node?.data ?? d) as SubnetOutputNodeData
      },
      getNodes,
      getEdges,
      updateNodeData,
    ),
    [id, getNodes, getEdges, updateNodeData, d]
  )

  // Register with cascade registry so upstream nodes can walk back to us.
  // NodeShell also registers via its own useEffect, but doing it here too
  // keeps the registration stable across footer-less renders.
  useEffect(() => {
    registerNodeRun(id, onRun)
    return () => unregisterNodeRun(id)
  }, [id, onRun])

  const displayName = d.name || 'output'
  const slotType: SlotType = d.slot_type || 'text'

  return (
    <NodeShell
      name={`${displayName} >`}
      icon="📤"
      selected={selected}
      inputSlots={[{ id: 'in', label: displayName, type: slotType }]}
      outputSlots={[]}
      onRun={onRun}
    >
      <div className={styles.nodeContent}>
        <div>
          <div className={styles.row}>
            <span className={styles.label}>Name</span>
          </div>
          <input
            className={styles.promptInput}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            placeholder="output_name"
            aria-label="Output name"
          />
        </div>
        <div>
          <div className={styles.row}>
            <span className={styles.label}>Type</span>
          </div>
          <select
            className={styles.select}
            value={slotType}
            onChange={handleSlotTypeChange}
            aria-label="Output slot type"
          >
            <option value="text">text</option>
            <option value="image">image</option>
            <option value="video">video</option>
            <option value="prompt">prompt</option>
            <option value="media">media</option>
          </select>
        </div>
        {d.handle_id && (
          <div className={styles.row}>
            <span className={styles.label}>handle_id</span>
            <span>{d.handle_id}</span>
          </div>
        )}
      </div>
    </NodeShell>
  )
}

export default memo(SubnetOutputNodeComponent)
