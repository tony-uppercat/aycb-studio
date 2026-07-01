import { useCallback } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { getNextNodeId } from './useCanvasDragDrop'
import type { NodeManifest } from '../nodes/index'
import { cloneNodeMedia, loadMedia, saveMediaForProject, generateMediaId } from '../mediaStore'
import { flipImageFile, type FlipAxis } from '../utils/flipImage'

const UNPACK_W = 230, UNPACK_H = 200, UNPACK_GAP = 20, UNPACK_COLS = 5

export function createUnpackedNodes(sourceNodes: Node[], allNodes: Node[]): Node[] {
  const result: Node[] = []
  for (const node of sourceNodes) {
    const hids = (node.data as Record<string, unknown>).historyIds as string[] | undefined
    if (!hids || hids.length === 0) continue
    let ax = node.position.x, ay = node.position.y
    let cur: Node | undefined = node
    while (cur?.parentId) {
      cur = allNodes.find(n => n.id === cur!.parentId)
      if (cur) { ax += cur.position.x; ay += cur.position.y }
    }
    const sx = ax + UNPACK_W + UNPACK_GAP * 2, sy = ay
    for (let i = 0; i < hids.length; i++) {
      result.push({
        id: getNextNodeId('imageUpload'),
        type: 'imageUpload',
        position: {
          x: sx + (i % UNPACK_COLS) * (UNPACK_W + UNPACK_GAP),
          y: sy + Math.floor(i / UNPACK_COLS) * (UNPACK_H + UNPACK_GAP),
        },
        data: { mediaId: hids[i] },
        selected: true,
      })
    }
  }
  return result
}

interface UseCanvasContextMenuActionsParams {
  getNodes: () => Node[]
  getEdges: () => Edge[]
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  snapshot: (nodes: Node[], edges: Edge[]) => void
  clipboardRef: React.MutableRefObject<{ nodes: Node[]; edges: Edge[] } | null>
  fitView: (opts?: { duration?: number; padding?: number }) => void
}

export function useCanvasContextMenuActions({
  getNodes, getEdges, setNodes, setEdges, snapshot, clipboardRef, fitView,
}: UseCanvasContextMenuActionsParams) {

  const ctxAddNode = useCallback((entry: NodeManifest, position: { x: number; y: number }) => {
    const id = getNextNodeId(entry.type)
    const newNode: Node = {
      id,
      type: entry.type,
      position: { x: position.x - 100, y: position.y - 50 },
      data: { ...entry.defaultData },
    }
    setNodes(ns => [...ns, newNode])
  }, [setNodes])

  const ctxSelectAll = useCallback(() => {
    setNodes(ns => ns.map(n => ({ ...n, selected: true })))
  }, [setNodes])

  const ctxFitView = useCallback(() => {
    fitView({ duration: 300, padding: 0.2 })
  }, [fitView])

  const ctxBypass = useCallback((nodes: Node[]) => {
    for (const n of nodes) {
      setNodes(ns => ns.map(nn =>
        nn.id === n.id ? { ...nn, data: { ...nn.data, _bypassed: !(nn.data as Record<string, unknown>)._bypassed } } : nn
      ))
    }
  }, [setNodes])

  // Toggle the _blocked flag: blocked nodes (and their parents) are skipped in
  // chain runs. If a mixed selection is toggled, drive all to the same state
  // based on whether any are currently unblocked.
  const ctxBlock = useCallback((nodes: Node[]) => {
    const ids = new Set(nodes.map(n => n.id))
    const anyUnblocked = nodes.some(n => !(n.data as Record<string, unknown>)._blocked)
    setNodes(ns => ns.map(nn =>
      ids.has(nn.id) ? { ...nn, data: { ...nn.data, _blocked: anyUnblocked } } : nn
    ))
  }, [setNodes])

  const ctxDuplicate = useCallback(async (nodes: Node[]) => {
    const newNodes = await Promise.all(nodes.map(async n => ({
      ...n,
      id: getNextNodeId(n.type || 'unknown'),
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      selected: true,
      data: await cloneNodeMedia(n.data as Record<string, unknown>),
    })))
    const postNodes = [...getNodes().map(n => ({ ...n, selected: false })), ...newNodes]
    snapshot(postNodes, getEdges())
    setNodes(postNodes)
  }, [getNodes, getEdges, setNodes, snapshot])

  // Flip each selected image node's media in place: load the current file,
  // mirror it on a canvas, save under a fresh mediaId so downstream re-pulls.
  // Nodes without a mediaId are skipped. One snapshot for undo.
  const ctxFlip = useCallback(async (nodes: Node[], axis: FlipAxis) => {
    const updates: Record<string, string> = {}
    for (const n of nodes) {
      const mid = (n.data as Record<string, unknown>).mediaId
      if (typeof mid !== 'string') continue
      const file = await loadMedia(mid)
      if (!file) continue
      const flipped = await flipImageFile(file, axis)
      const newMid = generateMediaId()
      await saveMediaForProject(newMid, flipped)
      updates[n.id] = newMid
    }
    if (Object.keys(updates).length === 0) return
    const postNodes = getNodes().map(n =>
      updates[n.id] ? { ...n, data: { ...n.data, mediaId: updates[n.id] } } : n
    )
    snapshot(postNodes, getEdges())
    setNodes(postNodes)
  }, [getNodes, getEdges, setNodes, snapshot])

  const ctxCopy = useCallback((nodes: Node[]) => {
    const nodeIds = new Set(nodes.map(n => n.id))
    const internalEdges = getEdges().filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    clipboardRef.current = { nodes, edges: internalEdges }
  }, [getEdges, clipboardRef])

  const ctxPaste = useCallback(async () => {
    if (!clipboardRef.current) return
    const { nodes: clipNodes, edges: clipEdges } = clipboardRef.current
    const idMap: Record<string, string> = {}
    const newNodes = await Promise.all(clipNodes.map(async n => {
      const newId = getNextNodeId(n.type || 'unknown')
      idMap[n.id] = newId
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: true,
        data: await cloneNodeMedia(n.data as Record<string, unknown>),
      }
    }))
    const newEdges = clipEdges.map(e => ({
      ...e,
      id: `e-${idMap[e.source]}-${idMap[e.target]}-${Date.now()}`,
      source: idMap[e.source] ?? e.source,
      target: idMap[e.target] ?? e.target,
    }))
    const postNodes = [...getNodes().map(n => ({ ...n, selected: false })), ...newNodes]
    const postEdges = [...getEdges(), ...newEdges]
    snapshot(postNodes, postEdges)
    setNodes(postNodes)
    setEdges(postEdges)
  }, [getNodes, getEdges, setNodes, setEdges, snapshot, clipboardRef])

  const ctxDelete = useCallback((nodeIds: string[], edgeIds: string[]) => {
    const idSet = new Set(nodeIds)
    const edgeIdSet = new Set(edgeIds)
    const postNodes = getNodes().filter(n => !idSet.has(n.id))
    const postEdges = getEdges().filter(e => !edgeIdSet.has(e.id) && !idSet.has(e.source) && !idSet.has(e.target))
    snapshot(postNodes, postEdges)
    setNodes(postNodes)
    setEdges(postEdges)
  }, [getNodes, getEdges, setNodes, setEdges, snapshot])

  const ctxDeleteEdge = useCallback((edgeId: string) => {
    const postEdges = getEdges().filter(e => e.id !== edgeId)
    snapshot(getNodes(), postEdges)
    setEdges(postEdges)
  }, [getNodes, getEdges, setEdges, snapshot])

  const ctxGroup = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }))
  }, [])

  const ctxUngroup = useCallback(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true }))
  }, [])

  const ctxUnpack = useCallback((nodes: Node[]) => {
    const allNodes = getNodes()
    const created = createUnpackedNodes(nodes, allNodes)
    if (created.length === 0) return
    const postNodes = [...allNodes.map(n => ({ ...n, selected: false })), ...created]
    snapshot(postNodes, getEdges())
    setNodes(postNodes)
  }, [getNodes, getEdges, setNodes, snapshot])

  return {
    ctxAddNode, ctxSelectAll, ctxFitView, ctxBypass, ctxBlock, ctxDuplicate,
    ctxCopy, ctxPaste, ctxDelete, ctxDeleteEdge, ctxGroup, ctxUngroup, ctxUnpack,
    ctxFlip,
  }
}
