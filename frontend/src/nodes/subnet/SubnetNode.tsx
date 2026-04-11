import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Handle, Position, NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Box } from 'lucide-react'
import type { Node, Edge, Viewport } from '@xyflow/react'
import styles from './SubnetNode.module.css'
import { buildSubnetPins, type SubnetPin } from './useSubnetPins'
import { useSubnetPathStore } from '../../stores/subnetPathStore'

export interface SubnetNodeData {
  name: string
  color: string | null
  collapsed: boolean
  sub_graph: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
  external_inputs: SubnetPin[]
  external_outputs: SubnetPin[]
  last_preview_b64?: string
}

/** Pure equality check on two pin arrays. Used to guard against infinite
 *  effect loops when the sub_graph changes but its derived pins do not. */
export function pinsEqual(a: SubnetPin[], b: SubnetPin[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.handle_id !== y.handle_id) return false
    if (x.name !== y.name) return false
    if (x.slot_type !== y.slot_type) return false
  }
  return true
}

/** Build a patch object for updateNodeData when a subnet's sub_graph changes.
 *  Returns `null` if the pins match the current external_inputs/outputs, so
 *  callers can skip the update and avoid re-render loops. */
export function computePinPatch(
  sub_nodes: Node[],
  current_inputs: SubnetPin[],
  current_outputs: SubnetPin[]
): { external_inputs: SubnetPin[]; external_outputs: SubnetPin[] } | null {
  const { external_inputs, external_outputs } = buildSubnetPins(sub_nodes)
  if (
    pinsEqual(external_inputs, current_inputs) &&
    pinsEqual(external_outputs, current_outputs)
  ) {
    return null
  }
  return { external_inputs, external_outputs }
}

/** Pure rename handler — trims input and falls back to 'Subnet' when empty. */
export function applyRename(
  update: (id: string, patch: Partial<SubnetNodeData>) => void,
  id: string,
  next: string
): void {
  const trimmed = next.trim()
  update(id, { name: trimmed || 'Subnet' })
}

/** Pure collapse toggle. */
export function toggleCollapsed(
  update: (id: string, patch: Partial<SubnetNodeData>) => void,
  id: string,
  current: boolean
): void {
  update(id, { collapsed: !current })
}

function SubnetNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as SubnetNodeData
  const { updateNodeData } = useReactFlow()

  const sub_nodes = d.sub_graph?.nodes ?? []
  const child_count = sub_nodes.length
  const external_inputs = useMemo(() => d.external_inputs ?? [], [d.external_inputs])
  const external_outputs = useMemo(() => d.external_outputs ?? [], [d.external_outputs])

  // Refresh pins whenever the sub_graph's nodes change. The current pins are
  // read via a ref (updated every render) so the effect dep array stays
  // minimal — otherwise the write via updateNodeData would retrigger the
  // effect every time through the external_inputs/outputs dependency.
  const pins_ref = useRef({ inputs: external_inputs, outputs: external_outputs })
  pins_ref.current = { inputs: external_inputs, outputs: external_outputs }
  useEffect(() => {
    const patch = computePinPatch(sub_nodes, pins_ref.current.inputs, pins_ref.current.outputs)
    if (patch) updateNodeData(id, patch)
  }, [sub_nodes, id, updateNodeData])

  const handleRenameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      applyRename(updateNodeData as (id: string, patch: Partial<SubnetNodeData>) => void, id, e.target.value)
    },
    [id, updateNodeData]
  )

  const handleCollapseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleCollapsed(updateNodeData as (id: string, patch: Partial<SubnetNodeData>) => void, id, d.collapsed)
    },
    [id, updateNodeData, d.collapsed]
  )

  // Double-click on the container opens the SubnetEditor modal. The rename
  // input below has its own stopDoubleClick handler so typing in the name
  // field doesn't dive in by mistake.
  const openEditor = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      useSubnetPathStore.getState().enter(id)
    },
    [id],
  )

  const stopDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  const borderColor = d.color ?? '#F52776'

  return (
    <div
      className={styles.subnet}
      style={{ borderColor }}
      data-testid={`subnet-${id}`}
      onDoubleClick={openEditor}
    >
      <NodeResizer
        minWidth={180}
        minHeight={80}
        isVisible={selected && !d.collapsed}
        color={borderColor}
        lineStyle={{ borderWidth: 1 }}
        handleStyle={{ width: 6, height: 6, borderRadius: 2 }}
      />

      <div className={styles.header} style={{ background: `${borderColor}14` }}>
        <Box size={14} strokeWidth={1.5} className={styles.headerIcon} />
        <input
          className={`${styles.nameInput} nodrag nopan`}
          value={d.name}
          onChange={handleRenameChange}
          onDoubleClick={stopDoubleClick}
          spellCheck={false}
          aria-label="Subnet name"
        />
        <button
          type="button"
          className={`${styles.collapseBtn} nodrag`}
          onClick={handleCollapseClick}
          aria-label={d.collapsed ? 'Expand subnet' : 'Collapse subnet'}
          title={d.collapsed ? 'Expand' : 'Collapse'}
        >
          {d.collapsed ? (
            <ChevronRight size={12} strokeWidth={1.5} />
          ) : (
            <ChevronDown size={12} strokeWidth={1.5} />
          )}
        </button>
      </div>

      <div className={d.collapsed ? styles.bodyCollapsed : styles.body}>
        <span className={styles.childCount}>
          {child_count} {child_count === 1 ? 'node' : 'nodes'}
        </span>
        <div className={styles.pinList}>
          {external_inputs.length === 0 && external_outputs.length === 0 && (
            <span className={styles.empty}>No pins</span>
          )}
          {external_inputs.map((pin) => (
            <div key={`in-${pin.handle_id}`} className={styles.pinRow}>
              <span className={styles.pinDot} />
              {pin.name}
            </div>
          ))}
          {external_outputs.map((pin) => (
            <div key={`out-${pin.handle_id}`} className={`${styles.pinRow} ${styles.pinRowOut}`}>
              {pin.name}
              <span className={styles.pinDot} />
            </div>
          ))}
        </div>
      </div>

      {external_inputs.map((pin, i) => (
        <Handle
          key={`handle-in-${pin.handle_id}`}
          type="target"
          position={Position.Left}
          id={pin.handle_id}
          className={styles.inputHandle}
          style={{ top: 40 + i * 18 }}
        />
      ))}
      {external_outputs.map((pin, i) => (
        <Handle
          key={`handle-out-${pin.handle_id}`}
          type="source"
          position={Position.Right}
          id={pin.handle_id}
          className={styles.outputHandle}
          style={{ top: 40 + i * 18 }}
        />
      ))}
    </div>
  )
}

export default memo(SubnetNodeComponent)
