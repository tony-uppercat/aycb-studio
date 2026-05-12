import { memo, useCallback, useEffect, useState } from 'react'
import { Handle, Position, useReactFlow, useStore, type Edge, type Node, type NodeProps } from '@xyflow/react'
import type { SlotType } from '../_shared/types'
import { toSnakeCase, pullBySlotType } from '../subnet/subnetUtils'
import { registerNodeRun, unregisterNodeRun } from '../../utils/cascadeRun'
import pinStyles from '../_shared/BoundaryPin.module.css'

const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2]

export interface SubnetOutputNodeData {
  handle_id: string
  name: string
  slot_type: SlotType
  result?: unknown
  [key: string]: unknown
}

const SLOT_TYPES: SlotType[] = ['text', 'image', 'video', 'prompt', 'media']

/**
 * Pure onRun builder for subnet-output.
 *
 * Reads the value connected to the 'in' handle (text/media based on slot_type)
 * and writes it into `data.result` via updateNodeData.
 *
 * Note: with the post-2026-05-04 reactive boundary in
 * useDataPropagation.resolveSource, external consumers no longer rely on
 * data.result — they walk DOWN sub_graph and follow the proxy's incoming
 * edge directly. This onRun is kept as a fallback for explicit-Run flows
 * (e.g. cascadeRun) and for tests.
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

/**
 * Boundary-pin rendering: a slim pill anchored to the right edge of the
 * subnet editor flow. The Handle protrudes to the left
 * (Position.Left, type="target") so internal nodes feed the proxy via
 * standard React Flow drag-connect.
 *
 * Selected state expands an inline editor (name + slot_type) on the right
 * side. Rename commits snake_case on blur.
 */
function SubnetOutputNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as SubnetOutputNodeData
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  // Counter-scale to keep the boundary pin fixed in screen px regardless of
  // the flow's zoom. transformOrigin pinned to the left edge so the Handle
  // stays anchored to the proxy's flow position.
  const zoom = useStore(zoomSelector)
  const inverseScale = zoom > 0 ? 1 / zoom : 1

  const [draft, setDraft] = useState(d.name ?? '')
  useEffect(() => { setDraft(d.name ?? '') }, [d.name])

  const commitRename = useCallback(() => {
    const snake = toSnakeCase(draft) || 'output'
    if (snake !== d.name) updateNodeData(id, { name: snake })
  }, [draft, d.name, id, updateNodeData])

  const handleSlotTypeChange = useCallback((next: SlotType) => {
    updateNodeData(id, { slot_type: next })
  }, [id, updateNodeData])

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

  // Keep the node's onRun registered with cascadeRun so explicit-Run flows
  // can still reach the proxy. The reactive read path bypasses this.
  useEffect(() => {
    registerNodeRun(id, onRun)
    return () => unregisterNodeRun(id)
  }, [id, onRun])

  const displayName = d.name || 'output'

  return (
    <div style={{ transform: `scale(${inverseScale})`, transformOrigin: 'left center' }}>
    <div className={pinStyles.pin} data-direction="output" data-selected={selected}>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className={pinStyles.handle}
      />
      <span className={pinStyles.label}>{displayName}</span>
      {selected && (
        <div className={pinStyles.editor} data-direction="output">
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
              placeholder="output_name"
              aria-label="Output name"
            />
          </div>
          <div className={pinStyles.editorRow}>
            <span className={pinStyles.editorLabel}>type</span>
            <select
              className={`${pinStyles.editorSelect} nodrag nopan`}
              value={d.slot_type || 'text'}
              onChange={(e) => handleSlotTypeChange(e.target.value as SlotType)}
              aria-label="Output slot type"
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

export default memo(SubnetOutputNodeComponent)
