import { useEffect } from 'react'
import type React from 'react'
import type { Node, Edge } from '@xyflow/react'
import { getNextNodeId } from './useCanvasDragDrop'
import {
  getAbsolutePosition,
  expandGroupChildren,
  cloneNodesAndEdges,
  deleteSelection,
  collectGroupDescendants,
  applyBypass,
  cleanupNodeMedia,
} from './useKeyboardShortcuts'
import { createUnpackedNodes } from './useCanvasContextMenuActions'

interface UseSubnetShortcutsParams {
  getNodes: () => Node[]
  getEdges: () => Edge[]
  setNodes: (updater: Node[] | ((nodes: Node[]) => Node[])) => void
  setEdges: (updater: Edge[] | ((edges: Edge[]) => Edge[])) => void
  snapshot: (nodes: Node[], edges: Edge[]) => void
  undo: () => void
  redo: () => void
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number }
  clipboardRef: React.MutableRefObject<{ nodes: Node[]; edges: Edge[] } | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  toggleAddMenu: () => void
}

export function useSubnetShortcuts({
  getNodes, getEdges, setNodes, setEdges,
  snapshot, undo, redo, screenToFlowPosition,
  clipboardRef, containerRef, toggleAddMenu,
}: UseSubnetShortcutsParams): void {

  useEffect(() => {
    console.log('[SubnetShortcuts] mount: listener attached')
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isEditable = (e.target as HTMLElement).isContentEditable
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable
      if (e.ctrlKey && (e.key === 'v' || e.key === 'c')) {
        console.log(`[SubnetShortcuts] Ctrl+${e.key.toUpperCase()} fired — target=${tag}, inInput=${inInput}, clip=`, clipboardRef.current ? `${clipboardRef.current.nodes.length} nodes` : 'EMPTY')
      }

      // Tab — toggle add-node menu
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !inInput) {
        e.preventDefault()
        toggleAddMenu()
        return
      }
      // Ctrl+Z / Ctrl+Shift+Z — undo/redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !inInput) {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      // Ctrl+G — group
      if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey) {
        e.preventDefault()
        const allNodes = getNodes()
        const selected = allNodes.filter(n => n.selected)
        if (selected.length < 2) return
        const PAD = 30, HEADER = 32
        const selectedIds = new Set(selected.map(n => n.id))
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        const absPos = new Map<string, { x: number; y: number }>()
        for (const n of selected) {
          const abs = getAbsolutePosition(n, allNodes)
          absPos.set(n.id, abs)
          const w = (n.style?.width as number) ?? n.measured?.width ?? n.width ?? 200
          const h = (n.style?.height as number) ?? n.measured?.height ?? n.height ?? 150
          minX = Math.min(minX, abs.x); minY = Math.min(minY, abs.y)
          maxX = Math.max(maxX, abs.x + w); maxY = Math.max(maxY, abs.y + h)
        }
        const gx = minX - PAD, gy = minY - PAD - HEADER
        const groupNode: Node = {
          id: getNextNodeId('group'), type: 'group',
          position: { x: gx, y: gy },
          data: { label: 'Group', collapsed: false },
          style: { width: maxX - minX + PAD * 2, height: maxY - minY + PAD * 2 + HEADER },
        }
        const updated = allNodes.map(n => {
          if (!selectedIds.has(n.id)) return { ...n, selected: false }
          const abs = absPos.get(n.id)!
          return { ...n, parentId: groupNode.id, position: { x: abs.x - gx, y: abs.y - gy }, selected: false }
        })
        const postNodes = [groupNode, ...updated]
        snapshot(postNodes, getEdges())
        setNodes(postNodes)
      }
      // Ctrl+Shift+G — ungroup
      if ((e.ctrlKey || e.metaKey) && e.key === 'g' && e.shiftKey) {
        e.preventDefault()
        const allNodes = getNodes()
        const groups = allNodes.filter(n => n.selected && n.type === 'group')
        if (groups.length === 0) return
        const groupIds = new Set(groups.map(g => g.id))
        const updated = allNodes.filter(n => !groupIds.has(n.id)).map(n => {
          if (!n.parentId || !groupIds.has(n.parentId)) return n
          const parent = groups.find(g => g.id === n.parentId)
          if (!parent) return n
          const pAbs = getAbsolutePosition(parent, allNodes)
          return { ...n, parentId: undefined, extent: undefined, position: { x: n.position.x + pAbs.x, y: n.position.y + pAbs.y } }
        })
        snapshot(updated, getEdges())
        setNodes(updated)
      }
      // Shift+Delete — delete group + children
      if (e.shiftKey && e.key === 'Delete' && !inInput) {
        const allNodes = getNodes()
        const selGroups = allNodes.filter(n => n.selected && n.type === 'group')
        if (selGroups.length === 0) return
        e.preventDefault()
        const toDelete = collectGroupDescendants(selGroups, allNodes)
        const nodesToDel = allNodes.filter(n => toDelete.has(n.id))
        const { nodes, edges } = deleteSelection(allNodes, getEdges(), nodesToDel, [], { reconnect: false })
        snapshot(nodes, edges); setEdges(edges); setNodes(nodes)
        cleanupNodeMedia(nodesToDel)
      }
      // Backspace — delete without reconnection
      if (e.key === 'Backspace' && !inInput) {
        const selN = getNodes().filter(n => n.selected)
        const selE = getEdges().filter(ed => ed.selected)
        if (selN.length === 0 && selE.length === 0) return
        e.preventDefault()
        const { nodes, edges } = deleteSelection(getNodes(), getEdges(), selN, selE, { reconnect: false })
        snapshot(nodes, edges); setEdges(edges); setNodes(nodes)
        if (selN.length > 0) cleanupNodeMedia(selN)
      }
      // Delete — delete with reconnection (ungroup groups)
      if (e.key === 'Delete' && !e.shiftKey && !inInput) {
        const selN = getNodes().filter(n => n.selected)
        const selE = getEdges().filter(ed => ed.selected)
        if (selN.length === 0 && selE.length === 0) return
        e.preventDefault()
        const { nodes, edges } = deleteSelection(getNodes(), getEdges(), selN, selE, { reconnect: true })
        snapshot(nodes, edges); setEdges(edges); setNodes(nodes)
        if (selN.length > 0) cleanupNodeMedia(selN)
      }
      // B — bypass
      if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !inInput) {
        const sel = getNodes().filter(n => n.selected)
        if (sel.length > 0) {
          e.preventDefault()
          const { nodes, edges } = applyBypass(getNodes(), getEdges(), sel)
          snapshot(nodes, edges); setNodes(nodes); setEdges(edges)
        }
      }
      // U — unpack history
      if (e.code === 'KeyU' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !inInput) {
        const allNodes = getNodes()
        const created = createUnpackedNodes(allNodes.filter(n => n.selected), allNodes)
        if (created.length > 0) {
          e.preventDefault()
          const postNodes = [...allNodes.map(n => ({ ...n, selected: false })), ...created]
          snapshot(postNodes, getEdges()); setNodes(postNodes)
        }
      }
      // Ctrl+C — copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !inInput) {
        const allNodes = getNodes()
        const sel = expandGroupChildren(allNodes.filter(n => n.selected), allNodes)
        if (sel.length > 0) {
          const selIds = new Set(sel.map(n => n.id))
          clipboardRef.current = { nodes: sel, edges: getEdges().filter(ed => selIds.has(ed.source) && selIds.has(ed.target)) }
        }
      }
      // Ctrl+V — paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !inInput) {
        const clip = clipboardRef.current
        if (!clip || clip.nodes.length === 0) return
        e.preventDefault()
        const nodeIds = new Set(clip.nodes.map(n => n.id))
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const n of clip.nodes) {
          if (n.parentId && nodeIds.has(n.parentId)) continue
          const w = (n.style?.width as number) ?? n.measured?.width ?? n.width ?? 200
          const h = (n.style?.height as number) ?? n.measured?.height ?? n.height ?? 150
          minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y)
          maxX = Math.max(maxX, n.position.x + w); maxY = Math.max(maxY, n.position.y + h)
        }
        const rect = containerRef.current?.getBoundingClientRect()
        const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
        const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
        const vc = screenToFlowPosition({ x: cx, y: cy })
        const offset = { x: vc.x - (minX + maxX) / 2, y: vc.y - (minY + maxY) / 2 }
        void (async () => {
          const { clones, clonedEdges } = await cloneNodesAndEdges(clip.nodes, clip.edges, 'paste', offset)
          clones.forEach(n => { n.selected = true })
          const postNodes = [...getNodes().map(n => ({ ...n, selected: false })), ...clones]
          const postEdges = [...getEdges(), ...clonedEdges]
          snapshot(postNodes, postEdges); setNodes(postNodes); setEdges(postEdges)
          console.log(`[SubnetPaste] ${clones.length} nodes pasted at offset`, offset)
        })()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      console.log('[SubnetShortcuts] unmount: listener detached')
      document.removeEventListener('keydown', onKey, true)
    }
  }, [getNodes, getEdges, setNodes, setEdges, snapshot, undo, redo, screenToFlowPosition, clipboardRef, containerRef, toggleAddMenu])
}
