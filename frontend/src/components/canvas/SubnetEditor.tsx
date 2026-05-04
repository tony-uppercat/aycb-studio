import { useCallback, useEffect, useMemo } from 'react'
import {
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type Edge,
  type Viewport,
} from '@xyflow/react'
import { X } from 'lucide-react'
import { useSubnetPathStore } from '../../stores/subnetPathStore'
import { SubnetEditorInner } from './SubnetEditorInner'
import styles from './SubnetEditor.module.css'

interface SubGraph {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
}

/**
 * Pure helper: return a new root_nodes array where the subnet with the given
 * id has its sub_graph replaced. Does not mutate input. Sibling nodes keep
 * their original references so consumers can use ref equality for skip logic.
 */
export function applySubGraphUpdate(
  root_nodes: Node[],
  subnet_id: string,
  sub_graph: SubGraph,
): Node[] {
  return root_nodes.map((n) => {
    if (n.id !== subnet_id) return n
    return { ...n, data: { ...(n.data as Record<string, unknown>), sub_graph } }
  })
}

/**
 * Build the `data` blob for a new node added via the editor toolbar.
 *
 * For generic nodes: spread the manifest's defaultData unchanged.
 * For subnet-input / subnet-output proxies: also assign a unique
 * `handle_id` so two proxies of the same direction in one subnet don't
 * collide (the manifest default is '' which would produce two React
 * `<Handle id="">` elements and ambiguous edge routing — audit finding
 * SC1). The id prefix (`in-` / `out-`) is cosmetic, the randomness is
 * load-bearing.
 */
export function buildProxyNodeData(
  type: string,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...defaults }
  if (type === 'subnet-input' || type === 'subnet-output') {
    const prefix = type === 'subnet-input' ? 'in' : 'out'
    data.handle_id = `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }
  return data
}

/**
 * Top-level SubnetEditor — renders nothing unless the subnet path store has
 * a non-empty current_path. Reads the active subnet id from the last path
 * segment and hands off to `SubnetEditorContent`.
 */
export function SubnetEditor(): React.ReactElement | null {
  const current_path = useSubnetPathStore((s) => s.current_path)
  const exit = useSubnetPathStore((s) => s.exit)

  if (current_path.length === 0) return null
  const subnet_id = current_path[current_path.length - 1]

  return <SubnetEditorContent subnet_id={subnet_id} onClose={exit} />
}

function SubnetEditorContent({
  subnet_id,
  onClose,
}: {
  subnet_id: string
  onClose: () => void
}): React.ReactElement {
  // This component is inside the OUTER ReactFlowProvider (rendered by
  // FlowCanvas), so `useReactFlow()` here returns the outer instance. We
  // capture its `setNodes` to write the final sub_graph back to the root.
  const outer = useReactFlow()
  const subnet = outer.getNodes().find((n) => n.id === subnet_id)
  const subnet_name =
    (subnet?.data as { name?: string } | undefined)?.name ?? 'Subnet'

  const initial_sub_graph = useMemo<SubGraph>(() => {
    const sg = (subnet?.data as { sub_graph?: Partial<SubGraph> } | undefined)
      ?.sub_graph
    return {
      nodes: sg?.nodes ?? [],
      edges: sg?.edges ?? [],
      viewport: sg?.viewport ?? { x: 0, y: 0, zoom: 1 },
    }
    // Only re-compute when the subnet id changes — editing the sub_graph
    // from inside the modal must NOT cause this to recompute, otherwise the
    // inner useNodesState would get the old snapshot back on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subnet_id])

  const handleSave = useCallback(
    (sub_graph: SubGraph) => {
      outer.setNodes((ns) => applySubGraphUpdate(ns, subnet_id, sub_graph))
    },
    [outer, subnet_id],
  )

  // Esc closes the modal. Skip when focus is inside a text field so renaming
  // proxies doesn't accidentally exit.
  useEffect(() => {
    const on_key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT')
      )
        return
      onClose()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [onClose])

  return (
    <div className={styles.overlay} role="dialog" aria-label={`Editing ${subnet_name}`}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>Editing: {subnet_name}</div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close subnet editor"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <div className={styles.body}>
          <ReactFlowProvider>
            <SubnetEditorInner
              initial_sub_graph={initial_sub_graph}
              onSave={handleSave}
            />
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  )
}

