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
import { Plus, LayoutGrid } from 'lucide-react'
import { NODE_TYPES, type NodeManifest } from '../../nodes/index'
import { getNextNodeId } from '../../hooks/useCanvasDragDrop'
import { useCanvasHistory } from '../../hooks/useCanvasHistory'
import { useCanvasContextMenuActions } from '../../hooks/useCanvasContextMenuActions'
import { useSubnetShortcuts } from '../../hooks/useSubnetShortcuts'
import { CanvasContextMenu, type ContextMenuTarget } from './CanvasContextMenu'
import { AddNodeMenu } from '../AddNodeMenu'
import { ProjectGallery } from '../project/ProjectGallery'
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
  const [templatesOpen, setTemplatesOpen] = useState(false)

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

  // ── Guarantee at least one input and one output proxy ──
  // The subnet must always expose 1 input pin + 1 output pin on its
  // boundary, even when empty. On mount, if either direction is missing,
  // seed a default proxy (slot_type 'text', name 'input'/'output'). Subsequent
  // user deletions re-seed on the next open.
  useEffect(() => {
    setNodes(ns => {
      const hasInput = ns.some(n => n.type === 'subnet-input')
      const hasOutput = ns.some(n => n.type === 'subnet-output')
      if (hasInput && hasOutput) return ns
      const additions: Node[] = []
      if (!hasInput) {
        additions.push({
          id: getNextNodeId('subnet-input'),
          type: 'subnet-input',
          position: { x: 0, y: 0 },
          data: buildProxyNodeData('subnet-input', { name: 'input', slot_type: 'text' }),
        })
      }
      if (!hasOutput) {
        additions.push({
          id: getNextNodeId('subnet-output'),
          type: 'subnet-output',
          position: { x: 0, y: 0 },
          data: buildProxyNodeData('subnet-output', { name: 'output', slot_type: 'text' }),
        })
      }
      return [...ns, ...additions]
    })
    // Run once on mount only; deletions during the session are intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Boundary pin anchoring ──
  // Pin the subnet-input / subnet-output proxies to the left/right edges of
  // the visible viewport, stacked vertically. Recomputed on viewport pan/zoom
  // and on proxy add/remove. Position is in flow coords (so the spacing
  // adapts to zoom). Drag is disabled so the user can't accidentally rip a
  // pin off the boundary — rename/slot edits go through the proxy's inline
  // editor when selected.
  const proxyCount = nodes.filter(
    n => n.type === 'subnet-input' || n.type === 'subnet-output',
  ).length
  useEffect(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const MARGIN = 16
    const PIN_WIDTH = 130
    const START_Y_SCREEN = 56
    const STEP_Y_SCREEN = 38
    setNodes(ns => {
      let inputIdx = 0
      let outputIdx = 0
      let changed = false
      const out = ns.map(n => {
        let target: { x: number; y: number } | null = null
        if (n.type === 'subnet-input') {
          const ys = rect.top + START_Y_SCREEN + (inputIdx++) * STEP_Y_SCREEN
          target = screenToFlowPosition({ x: rect.left + MARGIN, y: ys })
        } else if (n.type === 'subnet-output') {
          const ys = rect.top + START_Y_SCREEN + (outputIdx++) * STEP_Y_SCREEN
          target = screenToFlowPosition({ x: rect.right - MARGIN - PIN_WIDTH, y: ys })
        }
        if (!target) return n
        const samePos = n.position.x === target.x && n.position.y === target.y
        if (samePos && n.draggable === false) return n
        changed = true
        return { ...n, position: target, draggable: false }
      })
      return changed ? out : ns
    })
  }, [viewport, proxyCount, screenToFlowPosition, setNodes])

  const onConnect = useCallback(
    (params: Connection) => { setEdges(es => addEdge(params, es)) },
    [setEdges],
  )

  // ── Add node menu ──
  // Mirrors handleAddNode in useConnectionHandlers: drop the new node at the
  // visible viewport center using screenToFlowPosition over the inner canvas
  // bounds, with the same -150/-100 offset so it lands roughly centered on
  // its own width/height.
  const addNode = useCallback(
    (entry: NodeManifest) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      const pos = screenToFlowPosition({ x: cx, y: cy })
      const new_node: Node = {
        id: getNextNodeId(entry.type),
        type: entry.type,
        position: { x: pos.x - 150, y: pos.y - 100 },
        data: buildProxyNodeData(entry.type, entry.defaultData ?? {}),
      }
      setNodes(ns => [...ns, new_node])
      setAddMenuOpen(false)
    },
    [setNodes, screenToFlowPosition],
  )

  // ── Insert template ──
  // Mirrors FlowCanvas.handleTemplateSelect but writes into the inner sub_graph.
  // Centers the template's bounding box on the subnet viewport, remaps node ids
  // to avoid collisions, rewrites edge endpoints to the new ids.
  const insertTemplate = useCallback(
    (templateNodes: Node[], templateEdges: Edge[]) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of templateNodes) {
        const w = (n.style?.width as number) ?? n.measured?.width ?? n.width ?? 200
        const h = (n.style?.height as number) ?? n.measured?.height ?? n.height ?? 150
        const nx = n.position?.x ?? 0
        const ny = n.position?.y ?? 0
        minX = Math.min(minX, nx); minY = Math.min(minY, ny)
        maxX = Math.max(maxX, nx + w); maxY = Math.max(maxY, ny + h)
      }
      const tplCx = (minX + maxX) / 2
      const tplCy = (minY + maxY) / 2

      const rect = canvasRef.current?.getBoundingClientRect()
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
      const vc = screenToFlowPosition({ x: cx, y: cy })
      const offX = vc.x - tplCx
      const offY = vc.y - tplCy

      const idMap: Record<string, string> = {}
      const newNodes = templateNodes.map(n => {
        const newId = getNextNodeId(n.type || 'unknown')
        idMap[n.id] = newId
        const isChild = n.parentId && idMap[n.parentId]
        return {
          ...n,
          id: newId,
          position: isChild
            ? n.position
            : { x: (n.position?.x ?? 0) + offX, y: (n.position?.y ?? 0) + offY },
          ...(n.parentId ? { parentId: idMap[n.parentId] ?? n.parentId } : {}),
          selected: false,
        }
      })
      const newEdges = templateEdges.map(e => ({
        ...e,
        id: `e-${idMap[e.source] ?? e.source}-${idMap[e.target] ?? e.target}-${Date.now()}`,
        source: idMap[e.source] ?? e.source,
        target: idMap[e.target] ?? e.target,
      }))
      const postNodes = [...getNodes(), ...newNodes]
      const postEdges = [...getEdges(), ...newEdges]
      snapshot(postNodes, postEdges)
      setNodes(postNodes)
      setEdges(postEdges)
      setTemplatesOpen(false)
    },
    [screenToFlowPosition, getNodes, getEdges, setNodes, setEdges, snapshot],
  )

  return (
    <>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toolbarBtn} onClick={() => setAddMenuOpen(v => !v)} aria-expanded={addMenuOpen}>
          <Plus size={12} strokeWidth={1.5} /> Add Node
        </button>
        <button type="button" className={styles.toolbarBtn} onClick={() => setTemplatesOpen(true)} title="Templates">
          <LayoutGrid size={12} strokeWidth={1.5} /> Templates
        </button>
        <button type="button" className={styles.toolbarBtn} onClick={undo} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" className={styles.toolbarBtn} onClick={redo} title="Redo (Ctrl+Shift+Z)">Redo</button>
      </div>
      <AddNodeMenu
        open={addMenuOpen}
        onClose={() => setAddMenuOpen(false)}
        onAdd={addNode}
        onAddTemplate={insertTemplate}
      />
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
      <ProjectGallery
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onSelect={insertTemplate}
      />
    </>
  )
}
