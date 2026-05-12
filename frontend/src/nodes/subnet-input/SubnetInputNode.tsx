import { memo, useCallback, useEffect, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { Handle, Position, useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import type { SlotType } from '../_shared/types'
import { toSnakeCase } from '../subnet/subnetUtils'
import { findNodePathInTree, resolveLevel } from '../../hooks/subnetTreeHelpers'
import { getRootTree } from '../../hooks/rootTreeGetter'
import { pullBySlotType } from '../subnet/subnetUtils'
import pinStyles from '../_shared/BoundaryPin.module.css'

const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2]

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
    const containing = findNodePathInTree(root_nodes, id)
    if (!containing || containing.length === 0) {
      updateNodeData(id, { result: null })
      return
    }
    const parent_subnet_id = containing[containing.length - 1]
    const parent_path = containing.slice(0, -1)
    const parent_level = resolveLevel(root_nodes, root_edges, parent_path)
    const incoming = parent_level.edges.find(
      (e) => e.target === parent_subnet_id && e.targetHandle === d.handle_id,
    )
    if (!incoming) {
      updateNodeData(id, { result: null })
      return
    }
    const slot_type = d.slot_type || 'text'
    const value = await pullBySlotType(
      slot_type, parent_subnet_id, d.handle_id,
      () => parent_level.nodes, () => parent_level.edges,
    )
    updateNodeData(id, { result: value })
  }
}

/**
 * Boundary-pin rendering: a slim pill anchored to the left edge of the
 * subnet editor flow (positioning is driven by SubnetEditorInner). The
 * Handle protrudes to the right (Position.Right, type="source") so internal
 * nodes can consume the proxy's data via standard React Flow drag-connect.
 *
 * Selected state expands an inline editor (name + slot_type). Edits write
 * through to data via updateNodeData; rename trims and snake_cases on blur.
 */
export function SubnetInputNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as SubnetInputNodeData
  const { updateNodeData } = useReactFlow()
  // Counter-scale to keep the boundary pin fixed in screen px regardless of
  // the flow's zoom level. transformOrigin pinned to the right edge so the
  // Handle (on the right) stays anchored to the proxy's flow position.
  const zoom = useStore(zoomSelector)
  const inverseScale = zoom > 0 ? 1 / zoom : 1

  const [draft, setDraft] = useState(d.name ?? '')
  useEffect(() => { setDraft(d.name ?? '') }, [d.name])

  const commitRename = useCallback(() => {
    const snake = toSnakeCase(draft)
    if (snake && snake !== d.name) updateNodeData(id, { name: snake })
  }, [draft, d.name, id, updateNodeData])

  const handleSlotTypeChange = useCallback((next: SlotType) => {
    updateNodeData(id, { slot_type: next })
  }, [id, updateNodeData])

  const displayName = d.name || 'input'

  return (
    <div style={{ transform: `scale(${inverseScale})`, transformOrigin: 'right center' }}>
    <div className={pinStyles.pin} data-direction="input" data-selected={selected}>
      <span className={pinStyles.label}>{displayName}</span>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        className={pinStyles.handle}
      />
      {selected && (
        <div className={pinStyles.editor} data-direction="input">
          <div className={pinStyles.editorRow}>
            <span className={pinStyles.editorLabel}>name</span>
            <input
              className={`${pinStyles.editorInput} nodrag nopan`}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              spellCheck={false}
              aria-label="Subnet input name"
            />
          </div>
          <div className={pinStyles.editorRow}>
            <span className={pinStyles.editorLabel}>type</span>
            <select
              className={`${pinStyles.editorSelect} nodrag nopan`}
              value={d.slot_type || 'text'}
              onChange={(e) => handleSlotTypeChange(e.target.value as SlotType)}
              aria-label="Subnet input slot type"
            >
              {SLOT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}

export default memo(SubnetInputNode)
