import { memo, useCallback, useEffect, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import type { SlotType } from '../_shared/types'
import { toSnakeCase, pullBySlotType } from '../subnet/subnetUtils'
import { findNodePathInTree, resolveLevel } from '../../hooks/subnetTreeHelpers'
import { getRootTree } from '../../hooks/rootTreeGetter'
import styles from '../_shared/Node.module.css'

export interface SubnetInputNodeData {
  handle_id: string
  name: string
  slot_type: SlotType
  result?: unknown
}

const SLOT_TYPES: SlotType[] = ['text', 'image', 'video', 'prompt', 'media']

/**
 * Pure onRun builder for the subnet-input proxy.
 *
 * Walks UP the tree to locate the external edge feeding this proxy's pin on
 * the containing subnet, reads the upstream value at the parent level, and
 * writes it to `data.result` via `updateNodeData`.
 *
 * Failure semantics (all write `{ result: null }` so downstream consumers see
 * an explicit "nothing to read"):
 *   - proxy is orphaned (not inside any subnet)
 *   - the parent subnet has no incoming edge on this handle_id
 *
 * All inputs are injected so tests can feed a fake tree without touching the
 * global `rootTreeGetter` module state.
 */
export function buildInputOnRun(
  id: string,
  get_data: () => SubnetInputNodeData,
  get_root_tree: () => { root_nodes: Node[]; root_edges: Edge[] },
  updateNodeData: (id: string, patch: Record<string, unknown>) => void,
): () => Promise<void> {
  return async function onRun(): Promise<void> {
    const d = get_data()
    const { root_nodes, root_edges } = get_root_tree()

    // 1. Find where this proxy lives in the tree.
    const containing = findNodePathInTree(root_nodes, id)
    if (!containing || containing.length === 0) {
      // Orphan — not inside any subnet. Cannot read external value.
      updateNodeData(id, { result: null })
      return
    }

    // 2. Identify the subnet that directly contains this proxy and the path
    //    to that subnet's own parent level (one level above the proxy).
    const parent_subnet_id = containing[containing.length - 1]
    const parent_path = containing.slice(0, -1)
    const parent_level = resolveLevel(root_nodes, root_edges, parent_path)

    // 3. Build parent-level getters so pullText / pullMedia search the parent
    //    level's graph. They will find the edge where
    //      target === parent_subnet_id && targetHandle === d.handle_id
    //    which is exactly the external edge feeding this proxy's pin.
    const get_parent_nodes = () => parent_level.nodes
    const get_parent_edges = () => parent_level.edges

    // 4. Guard: if no edge targets the parent subnet on this handle, bail.
    //    pullText would return '' in this case, but we want explicit null so
    //    the consumer can distinguish "no connection" from "empty string".
    const incoming = parent_level.edges.find(
      (e) => e.target === parent_subnet_id && e.targetHandle === d.handle_id,
    )
    if (!incoming) {
      updateNodeData(id, { result: null })
      return
    }

    // 5. Read the value based on slot type (shared helper — same as
    //    buildOutputOnRun's dispatch).
    const slot_type = d.slot_type || 'text'
    const value = await pullBySlotType(
      slot_type, parent_subnet_id, d.handle_id,
      get_parent_nodes, get_parent_edges,
    )
    updateNodeData(id, { result: value })
  }
}

export function SubnetInputNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as SubnetInputNodeData
  const { updateNodeData } = useReactFlow()

  // Bind the pure helper to the live component. `get_data` reads through
  // closure so each invocation sees the latest slot_type / handle_id edits.
  const onRun = useCallback(
    buildInputOnRun(
      id,
      () => data as unknown as SubnetInputNodeData,
      () => getRootTree(),
      updateNodeData,
    ),
    [id, data, updateNodeData],
  )

  // Local draft so the user can type spaces/caps; committed to snake_case on blur.
  const [draft, setDraft] = useState(d.name ?? '')
  useEffect(() => {
    setDraft(d.name ?? '')
  }, [d.name])

  const commitRename = useCallback(() => {
    const snake = toSnakeCase(draft)
    if (snake !== d.name) updateNodeData(id, { name: snake })
  }, [draft, d.name, id, updateNodeData])

  const handleSlotTypeChange = useCallback(
    (next: SlotType) => {
      updateNodeData(id, { slot_type: next })
    },
    [id, updateNodeData]
  )

  const displayName = d.name || 'input'
  const inputValue = draft

  return (
    <NodeShell
      name="Subnet Input"
      selected={selected}
      icon="📥"
      outputSlots={[
        { id: 'out', label: displayName, type: d.slot_type || 'text' },
      ]}
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
            value={inputValue}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            spellCheck={false}
            aria-label="Subnet input name"
          />
        </div>
        <div>
          <div className={styles.row}>
            <span className={styles.label}>Type</span>
          </div>
          <select
            className={styles.select}
            value={d.slot_type || 'text'}
            onChange={(e) => handleSlotTypeChange(e.target.value as SlotType)}
            aria-label="Subnet input slot type"
          >
            {SLOT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
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

export default memo(SubnetInputNode)
