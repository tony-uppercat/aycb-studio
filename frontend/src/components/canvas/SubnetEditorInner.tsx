import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  SelectionMode,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
} from '@xyflow/react'
import { Plus } from 'lucide-react'
import { NODE_TYPES, NODE_CATALOG, type NodeManifest } from '../../nodes/index'
import { getNextNodeId } from '../../hooks/useCanvasDragDrop'
import { useCanvasHistory } from '../../hooks/useCanvasHistory'
import { useCanvasContextMenuActions } from '../../hooks/useCanvasContextMenuActions'
import { useSubnetShortcuts } from '../../hooks/useSubnetShortcuts'
import { CanvasContextMenu, type ContextMenuTarget } from './CanvasContextMenu'
import { buildProxyNodeData } from './SubnetEditor'
import { canvasClipboard } from '../../stores/clipboardStore'
import styles from './SubnetEditor.module.css'

interface SubGraph {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
}

export function SubnetEditorInner({
  initial_sub_graph,
  onSave,
}: {
  initial_sub_graph: SubGraph
  onSave: (sg: SubGraph) => void
}): React.ReactElement {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial_sub_graph.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial_sub_graph.edges)
  const [viewport, setViewport] = useState<Viewport>(initial_sub_graph.viewport)
  const { getNodes, getEdges, fitView, screenToFlowPosition } = useReactFlow()

  // ── Undo / Redo ──
  const { snapshot, undo, redo } = useCanvasHistory(
    getNodes, getEdges, setNodes, setEdges, initial_sub_graph,
  )

  // ── Shared clipboard + add menu ──
  const clipboardRef = canvasClipboard  // shared across main canvas + subnet editor
  const canvasRef = useRef<HTMLDivElement>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const toggleAddMenu = useCallback(() => setAddMenuOpen(v => !v), [])

  // ── Keyboard shortcuts ──
  useSubnetShortcuts({
    getNodes, getEdges, setNodes, setEdges,
    snapshot, undo, redo, screenToFlowPosition,
    clipboardRef, containerRef: canvasRef, toggleAddMenu,
  })
  const {
    ctxAddNode, ctxSelectAll, ctxFitView, ctxBypass, ctxDuplicate,
    ctxCopy, ctxPaste, ctxDelete, ctxDeleteEdge, ctxGroup, ctxUngroup, ctxUnpack,
  } = useCanvasContextMenuActions({
    getNodes, getEdges, setNodes, setEdges, snapshot, clipboardRef, fitView,
  })

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; target: ContextMenuTarget; flowPos?: { x: number; y: number }
  } | null>(null)

  const handleNodeContextMenu = useCallback(
    (_: React.MouseEvent | MouseEvent, node: Node) => {
      _.preventDefault()
      const selected = getNodes().filter(n => n.selected)
      if (selected.length > 1) {
        setCtxMenu({ x: _.clientX, y: _.clientY, target: { kind: 'selection', selectedNodes: selected } })
      } else {
        setCtxMenu({ x: _.clientX, y: _.clientY, target: { kind: 'node', node } })
      }
    }, [getNodes],
  )
  const handleSelectionContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault()
      const selected = getNodes().filter(n => n.selected)
      if (selected.length === 0) return
      setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'selection', selectedNodes: selected } })
    }, [getNodes],
  )
  const handlePaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault()
      const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'pane', canPaste: clipboardRef.current !== null }, flowPos })
    }, [screenToFlowPosition],
  )
  const handleEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.preventDefault()
      setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: 'edge', edge } })
    }, [],
  )

  // ── Middle-mouse fix ──
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    let midDown = false
    const onDown = (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); midDown = true } }
    const onUp = (e: MouseEvent) => { if (e.button === 1) midDown = false }
    const onWheel = (e: WheelEvent) => { if (midDown) { e.preventDefault(); e.stopPropagation() } }
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => { el.removeEventListener('mousedown', onDown); window.removeEventListener('mouseup', onUp); el.removeEventListener('wheel', onWheel) }
  }, [])

  // ── Auto-save back to parent ──
  const save_ref = useRef(onSave)
  save_ref.current = onSave
  const did_mount_ref = useRef(false)
  useEffect(() => {
    if (!did_mount_ref.current) { did_mount_ref.current = true; return }
    save_ref.current({ nodes, edges, viewport })
  }, [nodes, edges, viewport])

  const onConnect = useCallback(
    (params: Connection) => { setEdges(es => addEdge(params, es)) },
    [setEdges],
  )

  // ── Add node menu ──
  const addNode = useCallback(
    (type: string) => {
      const manifest = NODE_CATALOG.find(m => m.type === type)
      const new_node: Node = {
        id: getNextNodeId(type), type,
        position: { x: 120, y: 120 },
        data: buildProxyNodeData(type, manifest?.defaultData ?? {}),
      }
      setNodes(ns => [...ns, new_node])
      setAddMenuOpen(false)
    }, [setNodes],
  )

  return (
    <>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toolbarBtn} onClick={() => setAddMenuOpen(v => !v)} aria-expanded={addMenuOpen}>
          <Plus size={12} strokeWidth={1.5} /> Add Node
        </button>
        <button type="button" className={styles.toolbarBtn} onClick={undo} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" className={styles.toolbarBtn} onClick={redo} title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
      {addMenuOpen && (
        <div className={styles.addNodeMenu}>
          {NODE_CATALOG
            .filter(m => m.type !== 'subnet' && m.type !== 'subnet-input' && m.type !== 'subnet-output')
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(m => (
              <button key={m.type} type="button" className={styles.addNodeItem} onClick={() => addNode(m.type)}>
                {m.label}
              </button>
            ))}
        </div>
      )}
      <div ref={canvasRef} style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          defaultViewport={viewport}
          onMove={(_, vp) => setViewport(vp)}
          onNodeContextMenu={handleNodeContextMenu}
          onSelectionContextMenu={handleSelectionContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onEdgeContextMenu={handleEdgeContextMenu}
          selectionOnDrag={true}
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1]}
          deleteKeyCode={null}
          minZoom={0.1}
          maxZoom={4}
          fitView={false}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      {ctxMenu && (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          target={ctxMenu.target}
          allEdges={getEdges()}
          onClose={() => setCtxMenu(null)}
          onAddNode={ctxAddNode}
          onPaste={ctxPaste}
          onSelectAll={ctxSelectAll}
          onFitView={ctxFitView}
          onDuplicate={ctxDuplicate}
          onCopy={ctxCopy}
          onDelete={ctxDelete}
          onBypass={ctxBypass}
          onGroup={ctxGroup}
          onUngroup={ctxUngroup}
          onUnpack={ctxUnpack}
          onDeleteEdge={ctxDeleteEdge}
          flowPosition={ctxMenu.flowPos}
        />
      )}
    </>
  )
}
