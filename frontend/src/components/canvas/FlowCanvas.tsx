import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../../stores/canvasStore'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow, SelectionMode,
  type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { NODE_TYPES } from '../../nodes/index'
import { BackendStatusDot } from '../BackendStatusDot'
import { WorkflowManager } from '../WorkflowManager'
import { SettingsPanel } from '../SettingsPanel'
import { MediaBrowser } from '../media/MediaBrowser'
import { FullscreenMediaBrowser } from '../media/FullscreenMediaBrowser'
import { AddNodeMenu } from '../AddNodeMenu'
import { ConsolePanel } from '../console/ConsolePanel'
import { saveMediaForProject, generateMediaId } from '../../mediaStore'
import { migrateStorageKeys } from '../../presets'

// One-time migration: geminishot_* → aycb_* localStorage keys (idempotent)
migrateStorageKeys()
import { useCanvasDragDrop } from '../../hooks/useCanvasDragDrop'
import { useCanvasHistory } from '../../hooks/useCanvasHistory'
import { useCanvasPersistence, serializeNodes } from '../../hooks/useCanvasPersistence'
import { useAutosave } from '../../hooks/useAutosave'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useConnectionHandlers } from '../../hooks/useConnectionHandlers'
import { useNodeInsertOnEdge } from '../../hooks/useNodeInsertOnEdge'
import { useProjectIO } from '../../hooks/useProjectIO'
import { useCanvasCustomEvents } from '../../hooks/useCanvasCustomEvents'
import { useCanvasContextMenuActions } from '../../hooks/useCanvasContextMenuActions'
import { ProjectGallery } from '../project/ProjectGallery'
import { useSettings } from '../SettingsContext'
import { AlignToolbar } from '../AlignToolbar'
import { BackendBanner } from '../BackendBanner'
import { SaveIndicator } from '../SaveIndicator'
import { ProjectSwitcher } from '../project/ProjectSwitcher'
import { CanvasContextMenu, type ContextMenuTarget } from './CanvasContextMenu'
import { SubnetEditor } from './SubnetEditor'
import { canvasClipboard } from '../../stores/clipboardStore'
import { setRootTree, resetRootTree } from '../../hooks/rootTreeGetter'
import { getNextNodeId } from '../../hooks/useCanvasDragDrop'
import { CollageEditor } from '../CollageEditor'
import type { CollageImage } from '../CollageEditor'
import { useActiveProject } from '../../hooks/useActiveProject'
import { useBackendHealth } from '../../hooks/useBackendHealth'
import styles from './FlowCanvas.module.css'
import { ErrorBoundary } from '../ui/ErrorBoundary'

function FlowCanvasInner() {
  useBackendHealth()
  const activeProject = useActiveProject()
  const settingsOpen = useCanvasStore(s => s.settingsOpen)
  const addMenuOpen = useCanvasStore(s => s.addMenuOpen)
  const toggleAddMenu = useCanvasStore(s => s.toggleAddMenu)
  const consoleOpen = useCanvasStore(s => s.consoleOpen)
  const toggleConsole = useCanvasStore(s => s.toggleConsole)
  const minimapVisible = useCanvasStore(s => s.minimapVisible)
  const toggleMinimap = useCanvasStore(s => s.toggleMinimap)
  const storagePanelOpen = useCanvasStore(s => s.storagePanelOpen)
  const fullscreenBrowserOpen = useCanvasStore(s => s.fullscreenBrowserOpen)
  const toggleFullscreenBrowser = useCanvasStore(s => s.toggleFullscreenBrowser)
  const [privacy, setPrivacy] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: ContextMenuTarget; flowPos?: { x: number; y: number } } | null>(null)
  const clipboardRef = canvasClipboard  // shared across main canvas + subnet editor
  const [collageOpen, setCollageOpen] = useState(false)
  const [collageImages, setCollageImages] = useState<CollageImage[]>([])
  // Track blob URLs created for collage so we can revoke them on close
  const collageBlobUrlsRef = useRef<string[]>([])
  const exportStatus = useCanvasStore(s => s.exportStatus)
  const setExportStatus = useCanvasStore(s => s.setExportStatus)
  const { model, doEmbed } = useSettings()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const { screenToFlowPosition, getNodes, getEdges, setViewport, getViewport, fitView } = useReactFlow()

  // Mirror the root canvas tree into a module-level snapshot so subnet-input
  // proxy onRun callbacks can walk the full tree synchronously via getRootTree.
  useEffect(() => {
    setRootTree({ root_nodes: nodes, root_edges: edges })
  }, [nodes, edges])

  // Clear the mirror when switching projects so a stale tree can't leak.
  useEffect(() => {
    resetRootTree()
  }, [activeProject.projectId])

  // ── Shift+Rect additive selection ────────────────────────────────────────
  const shiftKeyRef = useRef(false)
  const preSelectionNodeIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftKeyRef.current = true }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftKeyRef.current = false }
    // Window blur (Alt+Tab) drops the keyup for Shift, leaving shiftKeyRef
    // stuck true and causing onSelectionChange to re-apply a stale snapshot
    // on subsequent clicks. Reset on focus loss.
    const onBlur = () => {
      shiftKeyRef.current = false
      preSelectionNodeIdsRef.current = new Set()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const onSelectionStart = useCallback(() => {
    if (shiftKeyRef.current) {
      // Snapshot currently selected node IDs before the rect selection replaces them
      preSelectionNodeIdsRef.current = new Set(getNodes().filter(n => n.selected).map(n => n.id))
    } else {
      preSelectionNodeIdsRef.current = new Set()
    }
  }, [getNodes])

  const onSelectionChange = useCallback(({ nodes: selectedNodes }: { nodes: Node[]; edges: Edge[] }) => {
    if (!shiftKeyRef.current || preSelectionNodeIdsRef.current.size === 0) return
    // Merge: the new rect-selected nodes + the previously selected nodes
    const newIds = new Set(selectedNodes.map(n => n.id))
    const previousIds = preSelectionNodeIdsRef.current
    // Check if any previously selected nodes lost selection — if so, restore them
    let needsRestore = false
    for (const id of previousIds) {
      if (!newIds.has(id)) { needsRestore = true; break }
    }
    if (needsRestore) {
      setNodes(ns => ns.map(n => {
        if (previousIds.has(n.id) && !n.selected) return { ...n, selected: true }
        return n
      }))
    }
  }, [setNodes])

  // Clear the snapshot once the rect-select drag ends. Without this, a stale
  // snapshot persists and onSelectionChange re-applies it on the next
  // shift-click, making previously-rect-selected nodes stick "on".
  const onSelectionEnd = useCallback(() => {
    preSelectionNodeIdsRef.current = new Set()
  }, [])

  const canvasRef = useRef<HTMLDivElement>(null)

  // ── Prevent middle-mouse autoscroll + accidental zoom while panning ──
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    let midDown = false
    const onDown = (e: MouseEvent) => {
      if (e.button === 1) { e.preventDefault(); midDown = true }
    }
    const onUp = (e: MouseEvent) => {
      if (e.button === 1) midDown = false
    }
    const onWheel = (e: WheelEvent) => {
      if (midDown) { e.preventDefault(); e.stopPropagation() }
    }
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  const { onDragOver, onDrop } = useCanvasDragDrop()
  const { snapshot, undo, redo, resetHistory, onDragStop: historyDragStop } = useCanvasHistory(
    getNodes, getEdges, setNodes, setEdges,
    { nodes: [], edges: [] },
  )

  // ── Insert node on edge (drag a node onto an edge to splice it in) ──
  const { onNodeDrag: onNodeDragForInsert, tryInsertOnEdge } = useNodeInsertOnEdge({
    getNodes, getEdges, setEdges, snapshot,
  })

  const onDragStop = useCallback(
    (event: React.MouseEvent, node: Node) => {
      // Ctrl+drag copy: create clones at destination, snap originals back to source
      if (onNodeDragStop()) return
      // Try to insert the node into a nearby edge first
      const inserted = tryInsertOnEdge(event, node)
      if (!inserted) {
        // No insertion — just snapshot for undo history as before
        historyDragStop()
      }
      // Unparent child if dragged outside group bounds
      if (node.parentId) {
        const allNodes = getNodes()
        const parent = allNodes.find(n => n.id === node.parentId)
        if (parent) {
          const pw = (parent.style?.width as number) ?? parent.measured?.width ?? 200
          const ph = (parent.style?.height as number) ?? parent.measured?.height ?? 150
          const nx = node.position.x
          const ny = node.position.y
          if (nx < -20 || ny < -20 || nx > pw + 20 || ny > ph + 20) {
            // Convert to absolute position and detach
            const absX = (parent.position?.x ?? 0) + nx
            const absY = (parent.position?.y ?? 0) + ny
            setNodes(ns => ns.map(n =>
              n.id === node.id
                ? { ...n, parentId: undefined, extent: undefined, position: { x: absX, y: absY } }
                : n
            ))
          }
        }
      }
    },
    [tryInsertOnEdge, historyDragStop, getNodes, setNodes],
  )
  useCanvasPersistence(nodes, edges, activeProject.projectId)
  useAutosave(activeProject.projectId)

  // Stable zero-arg snapshot for child components
  const doSnapshot = useCallback(() => snapshot(getNodes(), getEdges()), [snapshot, getNodes, getEdges])

  // Expose snapshot globally so any node can call it before data mutations
  useEffect(() => {
    useCanvasStore.getState().setSnapshotCanvas(doSnapshot)
    return () => useCanvasStore.getState().setSnapshotCanvas(null)
  }, [doSnapshot])

  // Reset undo history after active project loads from IndexedDB
  const projectResetRef = useRef<string | null>(null)
  useEffect(() => {
    if (activeProject.loading) return
    if (activeProject.projectId === projectResetRef.current) return
    projectResetRef.current = activeProject.projectId
    // Delay one frame to ensure setNodes/setEdges from project load have rendered
    requestAnimationFrame(() => resetHistory(getNodes(), getEdges()))
  }, [activeProject.loading, activeProject.projectId, resetHistory, getNodes, getEdges])

  // ── Custom events (split-grid, crop-as-new, batch-export, media-import) ──
  useCanvasCustomEvents({ getNodes, setNodes, setEdges, setExportStatus, screenToFlowPosition, canvasRef })

  // ── Keyboard shortcuts (group/ungroup, copy/paste, bypass, delete, etc.) ──
  const { onNodeDragStart, onNodeDragStop, handleStopAll } = useKeyboardShortcuts({
    getNodes,
    getEdges,
    setNodes,
    setEdges,
    snapshot,
    toggleAddMenu,
    toggleMinimap,
    toggleFullscreenBrowser,
    fitView,
    screenToFlowPosition,
  })

  // ── Connection handling (connect start/end, add-node-from-drag, validate) ──
  const {
    pendingConnection,
    setPendingConnection,
    pendingRef,
    onConnectStart,
    onConnectEnd,
    handleAddNodeFromDrag,
    handleAddNode,
    onConnect,
    isValidConnection,
  } = useConnectionHandlers({ getNodes, getEdges, setNodes, setEdges, snapshot, screenToFlowPosition })

  // ── Project export / import / folder export ──────────────────────────────
  const { handleProjectExport, handleProjectImport, handleExportToFolder } = useProjectIO({
    getNodes, getEdges, getViewport, setNodes, setEdges, setViewport, model, doEmbed,
  })

  // ── Canvas backup to disk ────────────────────────────────────────────────
  const handleProjectBackup = useCallback(() => {
    const pid = activeProject.projectId
    if (!pid) return
    const payload = {
      project_id: pid,
      nodes: serializeNodes(getNodes()),
      edges: getEdges(),
      viewport: getViewport(),
    }
    fetch('/api/canvas/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(err => console.warn('[AYCB] Manual canvas backup failed:', err))
  }, [activeProject.projectId, getNodes, getEdges, getViewport])

  const handleOpenBackupFolder = useCallback(() => {
    const pid = activeProject.projectId
    if (!pid) return
    fetch(`/api/canvas/backup/open?project_id=${encodeURIComponent(pid)}`)
      .catch(err => console.warn('[AYCB] Open backup folder failed:', err))
  }, [activeProject.projectId])

  // ── Canvas right-click context menu ──────────────────────────────────────

  // Node / selection right-click
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent, node: Node) => {
      event.preventDefault()
      const selected = getNodes().filter(n => n.selected)
      if (selected.length > 1) {
        setCtxMenu({ x: event.clientX, y: event.clientY, target: { kind: 'selection', selectedNodes: selected } })
      } else {
        setCtxMenu({ x: event.clientX, y: event.clientY, target: { kind: 'node', node } })
      }
    },
    [getNodes],
  )

  const handleSelectionContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault()
      const selected = getNodes().filter(n => n.selected)
      if (selected.length === 0) return
      setCtxMenu({ x: event.clientX, y: event.clientY, target: { kind: 'selection', selectedNodes: selected } })
    },
    [getNodes],
  )

  // Empty canvas right-click
  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault()
      const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setCtxMenu({
        x: event.clientX,
        y: event.clientY,
        target: { kind: 'pane', canPaste: canvasClipboard.current !== null },
        flowPos,
      })
    },
    [screenToFlowPosition],
  )

  // Edge right-click
  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault()
      setCtxMenu({ x: event.clientX, y: event.clientY, target: { kind: 'edge', edge } })
    },
    [],
  )

  // ── Context menu action callbacks ──
  const {
    ctxAddNode, ctxSelectAll, ctxFitView, ctxBypass, ctxDuplicate,
    ctxCopy, ctxPaste, ctxDelete, ctxDeleteEdge, ctxGroup, ctxUngroup, ctxUnpack,
  } = useCanvasContextMenuActions({ getNodes, getEdges, setNodes, setEdges, snapshot, clipboardRef, fitView })

  function handleClearCanvas(): void {
    const nodeCount = getNodes().length
    if (nodeCount === 0) return
    if (!confirm(`Clear ${nodeCount} nodes and all edges?`)) return
    setNodes([])
    setEdges([])
  }

  function handlePurgeStorage(): void {
    if (confirm('Purge all site data? (localStorage + IndexedDB)')) {
      try { localStorage.clear() } catch { /* ignore */ }
      try { indexedDB.databases?.().then(dbs => dbs.forEach(db => { if (db.name) indexedDB.deleteDatabase(db.name) })) } catch { /* ignore */ }
      setNodes([])
      setEdges([])
      window.location.reload()
    }
  }

  function handleWorkflowLoad(n: Node[], e: Edge[]): void {
    setNodes(n)
    setEdges(e)
  }

  function handleTemplateSelect(templateNodes: Node[], templateEdges: Edge[]): void {
    // Add template to existing canvas centered at current viewport
    // Calculate bounding box center of template nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of templateNodes) {
      const w = (n.style?.width as number) ?? n.measured?.width ?? n.width ?? 200
      const h = (n.style?.height as number) ?? n.measured?.height ?? n.height ?? 150
      const nx = n.position?.x ?? 0
      const ny = n.position?.y ?? 0
      minX = Math.min(minX, nx)
      minY = Math.min(minY, ny)
      maxX = Math.max(maxX, nx + w)
      maxY = Math.max(maxY, ny + h)
    }
    const tplCenterX = (minX + maxX) / 2
    const tplCenterY = (minY + maxY) / 2

    // Get viewport center in flow coordinates directly from viewport transform
    const vp = getViewport()
    const rect = canvasRef.current?.getBoundingClientRect()
    const w = rect?.width ?? window.innerWidth
    const h = rect?.height ?? window.innerHeight
    const viewCenterX = (-vp.x + w / 2) / vp.zoom
    const viewCenterY = (-vp.y + h / 2) / vp.zoom
    const offsetX = viewCenterX - tplCenterX
    const offsetY = viewCenterY - tplCenterY

    // Remap IDs to avoid collisions
    const idMap: Record<string, string> = {}
    const newNodes = templateNodes.map(n => {
      const newId = getNextNodeId(n.type || 'unknown')
      idMap[n.id] = newId
      const isChild = n.parentId && idMap[n.parentId]
      return {
        ...n,
        id: newId,
        position: isChild ? n.position : { x: (n.position?.x ?? 0) + offsetX, y: (n.position?.y ?? 0) + offsetY },
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
  }

  // ── Collage editor ─────────────────────────────────────────────────────────

  const handleOpenCollage = useCallback((images: CollageImage[]) => {
    // Track blob URLs so we can revoke them later
    collageBlobUrlsRef.current = images.map(img => img.url)
    setCollageImages(images)
    setCollageOpen(true)
  }, [])

  const handleCollageClose = useCallback(() => {
    // Revoke all blob URLs created for the collage
    for (const url of collageBlobUrlsRef.current) {
      try { URL.revokeObjectURL(url) } catch { /* ignore */ }
    }
    collageBlobUrlsRef.current = []
    setCollageImages([])
    setCollageOpen(false)
  }, [])

  // Revoke collage blob URLs on unmount (in case collage is open when component unmounts)
  useEffect(() => {
    return () => {
      for (const url of collageBlobUrlsRef.current) {
        try { URL.revokeObjectURL(url) } catch { /* ignore */ }
      }
      collageBlobUrlsRef.current = []
    }
  }, [])

  const handleCollageExport = useCallback(async (blob: Blob) => {
    // Save blob as a File to mediaStore and create a new ImageUploadNode at viewport center
    const filename = `collage-${Date.now()}.png`
    const file = new File([blob], filename, { type: 'image/png' })
    const mediaId = generateMediaId()
    await saveMediaForProject(mediaId, file)

    const vp = getViewport()
    const centerX = (-vp.x + window.innerWidth / 2) / vp.zoom
    const centerY = (-vp.y + window.innerHeight / 2) / vp.zoom

    const newNode: Node = {
      id: getNextNodeId('imageUpload'),
      type: 'imageUpload',
      position: { x: centerX - 100, y: centerY - 100 },
      data: { mediaId },
    }

    setNodes(ns => [...ns, newNode])
    handleCollageClose()
  }, [getViewport, setNodes, handleCollageClose])

  return (
    <div className={styles.root}>
      <BackendBanner />
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <span className={styles.brand}>AYCB</span>
          <ProjectSwitcher
            project={activeProject}
            onExport={handleProjectExport}
            onImport={handleProjectImport}
            onBackup={handleProjectBackup}
            onOpenFolder={handleOpenBackupFolder}
          />
          <button
            className={styles.addBtn}
            onClick={() => useCanvasStore.setState({ addMenuOpen: true })}
            title="Add node (Tab)"
          >+ Add Node</button>
          <button
            className={styles.addBtn}
            onClick={() => setGalleryOpen(true)}
            title="Project templates"
          >Templates</button>
          <button
            className={styles.iconBtn}
            onClick={() => {
              const vp = getViewport()
              const rect = canvasRef.current?.getBoundingClientRect()
              const w = rect?.width ?? window.innerWidth
              const h = rect?.height ?? window.innerHeight
              const cx = (-vp.x + w / 2) / vp.zoom - 100
              const cy = (-vp.y + h / 2) / vp.zoom - 40
              const newId = getNextNodeId('textNote')
              const next = [...getNodes(), { id: newId, type: 'textNote', position: { x: cx, y: cy }, data: { text: '', fontSize: 12, fontFamily: 'system' }, selected: true }]
              snapshot(next, getEdges())
              setNodes(next)
            }}
            title="Add text note"
            aria-label="Add text note"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
        </div>
        <div className={styles.topActions}>
          <SaveIndicator />
          <WorkflowManager nodes={nodes} edges={edges} onLoad={handleWorkflowLoad} />
          <button className={styles.iconBtn} onClick={undo} title="Undo" aria-label="Undo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H3M3 10l5-5M3 10l5 5"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={redo} title="Redo" aria-label="Redo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10H11a5 5 0 00-5 5v0a5 5 0 005 5h10M21 10l-5-5M21 10l-5 5"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={handleStopAll} title="Stop all" aria-label="Stop all">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={handleClearCanvas} title="Clear canvas" aria-label="Clear canvas">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={handlePurgeStorage} title="Purge site storage" aria-label="Purge site storage">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 2v6M12 22v-6M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M2 12h6M22 12h-6M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={toggleFullscreenBrowser} title="Fullscreen media browser (Ctrl+M)" aria-label="Fullscreen media browser">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={() => useCanvasStore.setState({ storagePanelOpen: true })} title="Media storage" aria-label="Media storage">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={handleExportToFolder} title="Export media to folder" aria-label="Export media to folder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><path d="M12 11v6M9 14l3 3 3-3"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={handleProjectExport} title="Export project as JSON" aria-label="Export project as JSON">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9,15 12,18 15,15"/></svg>
          </button>
          <button className={styles.iconBtn} onClick={handleProjectImport} title="Import project from JSON" aria-label="Import project from JSON">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="12" x2="12" y2="18"/><polyline points="9,15 12,12 15,15"/></svg>
          </button>
          {exportStatus && <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 2 }}>{exportStatus}</span>}
          <button
            className={styles.iconBtn}
            onClick={() => { document.body.classList.toggle('prv'); setPrivacy(p => !p) }}
            title="Privacy mode — hide sensitive info"
            aria-label="Privacy mode"
            style={privacy ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/>{!privacy && <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}</svg>
          </button>
          <a
            href="/review"
            className={styles.iconBtn}
            title="Review Hub"
            aria-label="Review Hub"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </a>
          <BackendStatusDot />
          <button className={styles.iconBtn} onClick={() => useCanvasStore.setState({ settingsOpen: true })} title="Settings" aria-label="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
        </div>
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => useCanvasStore.setState({ settingsOpen: false })} />

      <MediaBrowser open={storagePanelOpen} onClose={() => useCanvasStore.setState({ storagePanelOpen: false })} />
      {fullscreenBrowserOpen && (
        <FullscreenMediaBrowser open={fullscreenBrowserOpen} onClose={toggleFullscreenBrowser} />
      )}
      <ProjectGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} onSelect={handleTemplateSelect} />

      <AddNodeMenu
        open={addMenuOpen}
        onClose={() => { useCanvasStore.setState({ addMenuOpen: false }); pendingRef.current = null; setPendingConnection(null) }}
        onAdd={pendingConnection ? handleAddNodeFromDrag : handleAddNode}
        onAddTemplate={handleTemplateSelect}
        filter={pendingConnection ? {
          slotType: pendingConnection.slotType,
          direction: pendingConnection.handleType === 'source' ? 'output' : 'input'
        } : undefined}
        position={pendingConnection ? pendingConnection.position : undefined}
      />
      <div className={styles.canvas} ref={canvasRef}>
        <ErrorBoundary
          fallback={(error, reset) => (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              background: 'var(--surface-1, #1a1a1a)',
              gap: 12,
              color: 'var(--text-primary, #e8e8e8)',
              fontFamily: 'var(--font-body, sans-serif)',
            }}>
              <span style={{ color: '#ef4444', fontSize: 13, fontFamily: 'var(--font-mono, monospace)' }}>
                Canvas error: {error.message}
              </span>
              <button
                onClick={reset}
                style={{
                  padding: '6px 16px',
                  fontSize: 12,
                  borderRadius: 'var(--radius-md, 8px)',
                  border: '1px solid rgba(239,68,68,0.5)',
                  background: 'rgba(239,68,68,0.1)',
                  color: '#ef4444',
                  cursor: 'pointer',
                }}
              >
                Reset Canvas
              </button>
            </div>
          )}
          onError={(error) => {
            useCanvasStore.getState().addError({
              timestamp: new Date().toISOString(),
              nodeId: 'canvas',
              message: error.message,
            })
          }}
        >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDragForInsert}
          onNodeDragStop={onDragStop}
          onDragOver={onDragOver}
          onDrop={onDrop}
          isValidConnection={isValidConnection}
          nodeTypes={NODE_TYPES}
          colorMode="dark"
          onNodeContextMenu={handleNodeContextMenu}
          onSelectionContextMenu={handleSelectionContextMenu}
          onPaneContextMenu={handlePaneContextMenu}
          onEdgeContextMenu={handleEdgeContextMenu}
          onSelectionStart={onSelectionStart}
          onSelectionChange={onSelectionChange}
          onSelectionEnd={onSelectionEnd}

          selectionOnDrag={true}
          selectionMode={SelectionMode.Partial}
          elementsSelectable={true}
          multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
          panOnDrag={[1]}
          deleteKeyCode={null}
          fitView={false}
          minZoom={0.05}
          maxZoom={4}
        >
          <Background color="#1a1a1a" gap={20} />
          <Controls />
          {minimapVisible && (
            <MiniMap
              nodeColor="#aaa"
              nodeStrokeColor="#d4d4d8"
              nodeStrokeWidth={2}
              maskColor="rgba(0, 0, 0, 0.7)"
              maskStrokeColor="#f59e0b"
              maskStrokeWidth={2}
              pannable
              zoomable
              style={{
                backgroundColor: '#18181b',
                border: '1px solid #f59e0b55',
                borderRadius: 8,
                width: 180,
                height: 120,
              }}
            />
          )}
        </ReactFlow>
        </ErrorBoundary>
        <AlignToolbar doSnapshot={doSnapshot} containerRef={canvasRef} />
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
          onOpenCollage={handleOpenCollage}
          onUnpack={ctxUnpack}
          onDeleteEdge={ctxDeleteEdge}
          flowPosition={ctxMenu.flowPos}
        />
      )}
      {collageOpen && (
        <CollageEditor
          images={collageImages}
          onClose={handleCollageClose}
          onExport={handleCollageExport}
        />
      )}
      <SubnetEditor />
      <ConsolePanel open={consoleOpen} onToggle={toggleConsole} />
    </div>
  )
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  )
}
