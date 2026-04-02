import { useCallback } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { getNextNodeId } from './useCanvasDragDrop'
import type { NodeManifest } from '../nodes/index'

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

  const ctxDuplicate = useCallback((nodes: Node[]) => {
    const newNodes = nodes.map(n => ({
      ...n,
      id: getNextNodeId(n.type || 'unknown'),
      position: { x: n.position.x + 40, y: n.position.y + 40 },
      selected: true,
    }))
    const postNodes = [...getNodes().map(n => ({ ...n, selected: false })), ...newNodes]
    snapshot(postNodes, getEdges())
    setNodes(postNodes)
  }, [getNodes, getEdges, setNodes, snapshot])

  const ctxCopy = useCallback((nodes: Node[]) => {
    const nodeIds = new Set(nodes.map(n => n.id))
    const internalEdges = getEdges().filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    clipboardRef.current = { nodes, edges: internalEdges }
  }, [getEdges, clipboardRef])

  const ctxPaste = useCallback(() => {
    if (!clipboardRef.current) return
    const { nodes: clipNodes, edges: clipEdges } = clipboardRef.current
    const idMap: Record<string, string> = {}
    const newNodes = clipNodes.map(n => {
      const newId = getNextNodeId(n.type || 'unknown')
      idMap[n.id] = newId
      return { ...n, id: newId, position: { x: n.position.x + 40, y: n.position.y + 40 }, selected: true }
    })
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

  return {
    ctxAddNode, ctxSelectAll, ctxFitView, ctxBypass, ctxDuplicate,
    ctxCopy, ctxPaste, ctxDelete, ctxDeleteEdge, ctxGroup, ctxUngroup,
  }
}
