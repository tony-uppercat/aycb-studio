import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
} from '@xyflow/react'
import { X, Plus } from 'lucide-react'
import { NODE_TYPES, NODE_CATALOG } from '../../nodes/index'
import { useSubnetPathStore } from '../../stores/subnetPathStore'
import { getNextNodeId } from '../../hooks/useCanvasDragDrop'
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
            <InnerFlow
              initial_sub_graph={initial_sub_graph}
              onSave={handleSave}
            />
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  )
}

function InnerFlow({
  initial_sub_graph,
  onSave,
}: {
  initial_sub_graph: SubGraph
  onSave: (sg: SubGraph) => void
}): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initial_sub_graph.nodes,
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    initial_sub_graph.edges,
  )
  const [viewport, setViewport] = useState<Viewport>(initial_sub_graph.viewport)

  // Save back on every edit. Use a ref so onSave identity changes don't
  // re-trigger the effect and risk a render loop with the outer state.
  const save_ref = useRef(onSave)
  save_ref.current = onSave
  useEffect(() => {
    save_ref.current({ nodes, edges, viewport })
  }, [nodes, edges, viewport])

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((es) => addEdge(params, es))
    },
    [setEdges],
  )

  const [addMenuOpen, setAddMenuOpen] = useState(false)

  const addNode = useCallback(
    (type: string) => {
      const id = getNextNodeId(type)
      const manifest = NODE_CATALOG.find((m) => m.type === type)
      const new_node: Node = {
        id,
        type,
        position: { x: 120, y: 120 },
        data: { ...(manifest?.defaultData ?? {}) },
      }
      setNodes((ns) => [...ns, new_node])
      setAddMenuOpen(false)
    },
    [setNodes],
  )

  return (
    <>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => addNode('subnet-input')}
        >
          <Plus size={12} strokeWidth={1.5} /> Input
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => addNode('subnet-output')}
        >
          <Plus size={12} strokeWidth={1.5} /> Output
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => setAddMenuOpen((v) => !v)}
          aria-expanded={addMenuOpen}
        >
          <Plus size={12} strokeWidth={1.5} /> Add Node
        </button>
      </div>
      {addMenuOpen && (
        <div className={styles.addNodeMenu}>
          {NODE_CATALOG.filter(
            (m) => m.type !== 'subnet' && m.type !== 'subnet-input' && m.type !== 'subnet-output',
          )
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((m) => (
              <button
                key={m.type}
                type="button"
                className={styles.addNodeItem}
                onClick={() => addNode(m.type)}
              >
                {m.label}
              </button>
            ))}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={NODE_TYPES}
        defaultViewport={viewport}
        onMove={(_, vp) => setViewport(vp)}
        minZoom={0.1}
        maxZoom={4}
        fitView={false}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </>
  )
}
