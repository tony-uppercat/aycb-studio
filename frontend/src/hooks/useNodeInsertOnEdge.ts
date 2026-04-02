/**
 * Hook: insert a node into an edge when dragged and dropped onto it.
 *
 * During node drag, detects proximity to existing edges and highlights the
 * nearest compatible one. On drop, splices the dragged node into that edge
 * (removes old edge, creates source→node and node→target edges).
 */
import { useCallback, useRef } from 'react'
import type { Node, Edge, OnNodeDrag } from '@xyflow/react'
import { useReactFlow } from '@xyflow/react'
import { NODE_CATALOG, areSlotsCompatible, type SlotDef } from '../nodes/index'
import { getHandleType } from './useDataPropagation'
import { edgeStyle } from '../utils/edgeStyles'
import { enforceOneEdgePerInput } from './useConnectionHandlers'

const PROXIMITY_THRESHOLD = 40 // px in flow coordinates

/** ID prefix for the highlighted-edge class toggle */
const HIGHLIGHT_EDGE_CLASS = 'edge-insert-highlight'

interface UseNodeInsertOnEdgeParams {
  getNodes: () => Node[]
  getEdges: () => Edge[]
  setEdges: (updater: Edge[] | ((edges: Edge[]) => Edge[])) => void
  snapshot: (nodes: Node[], edges: Edge[]) => void
}

interface UseNodeInsertOnEdgeResult {
  onNodeDrag: OnNodeDrag
  /** Call inside onNodeDragStop — returns true if insertion happened (so caller can skip normal snapshot) */
  tryInsertOnEdge: (event: React.MouseEvent, node: Node) => boolean
}

/**
 * Shortest distance from point P to the line segment AB.
 */
function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const closestX = ax + t * dx
  const closestY = ay + t * dy
  return Math.hypot(px - closestX, py - closestY)
}

/**
 * Get the approximate center position of a node's handle in flow coordinates.
 * We approximate: output handles are on the right edge (x + width, y + height/2),
 * input handles are on the left edge (x, y + height/2).
 * For nodes with multiple handles, this is a simplification but works well enough.
 */
function getHandlePosition(node: Node, direction: 'source' | 'target'): { x: number; y: number } {
  const w = (node.measured?.width ?? node.width ?? 200) as number
  const h = (node.measured?.height ?? node.height ?? 150) as number
  if (direction === 'source') {
    return { x: node.position.x + w, y: node.position.y + h / 2 }
  }
  return { x: node.position.x, y: node.position.y + h / 2 }
}

/**
 * Get center of a node in flow coordinates.
 */
function getNodeCenter(node: Node): { x: number; y: number } {
  const w = (node.measured?.width ?? node.width ?? 200) as number
  const h = (node.measured?.height ?? node.height ?? 150) as number
  return { x: node.position.x + w / 2, y: node.position.y + h / 2 }
}

/**
 * Check if a node type can be spliced into an edge.
 * Returns the input and output handles to use, or null if incompatible.
 */
function findSpliceHandles(
  nodeType: string,
  sourceHandleId: string | null | undefined,
  targetHandleId: string | null | undefined,
): { inputHandle: string; outputHandle: string } | null {
  const entry = NODE_CATALOG.find(e => e.type === nodeType)
  if (!entry) return null

  const sourceSlotType = getHandleType(sourceHandleId)
  const targetSlotType = getHandleType(targetHandleId)

  // The node needs an input compatible with the edge's source output type
  // and an output compatible with the edge's target input type
  const compatInput = entry.inputs.find((s: SlotDef) => areSlotsCompatible(s.type, sourceSlotType))
  const compatOutput = entry.outputs.find((s: SlotDef) => areSlotsCompatible(s.type, targetSlotType))

  if (!compatInput || !compatOutput) return null

  return {
    inputHandle: compatInput.handleId,
    outputHandle: compatOutput.handleId,
  }
}

export function useNodeInsertOnEdge(params: UseNodeInsertOnEdgeParams): UseNodeInsertOnEdgeResult {
  const { getNodes, getEdges, setEdges, snapshot } = params
  const { getNode } = useReactFlow()

  // Track which edge is currently highlighted during drag
  const highlightedEdgeRef = useRef<string | null>(null)

  /** Remove the CSS highlight from the currently highlighted edge */
  const clearHighlight = useCallback(() => {
    if (highlightedEdgeRef.current) {
      const el = document.querySelector(`[data-testid="rf__edge-${highlightedEdgeRef.current}"]`)
        ?? document.querySelector(`.react-flow__edge[data-id="${highlightedEdgeRef.current}"]`)
      if (el) {
        el.classList.remove(HIGHLIGHT_EDGE_CLASS)
      }
      highlightedEdgeRef.current = null
    }
  }, [])

  /** Set CSS highlight on an edge */
  const setHighlight = useCallback((edgeId: string) => {
    if (highlightedEdgeRef.current === edgeId) return
    clearHighlight()
    const el = document.querySelector(`[data-testid="rf__edge-${edgeId}"]`)
      ?? document.querySelector(`.react-flow__edge[data-id="${edgeId}"]`)
    if (el) {
      el.classList.add(HIGHLIGHT_EDGE_CLASS)
      highlightedEdgeRef.current = edgeId
    }
  }, [clearHighlight])

  /**
   * Find the nearest edge to a dragged node, checking compatibility.
   */
  const findNearestCompatibleEdge = useCallback((draggedNode: Node): {
    edge: Edge
    distance: number
    handles: { inputHandle: string; outputHandle: string }
  } | null => {
    const nodeType = draggedNode.type
    if (!nodeType) return null

    const center = getNodeCenter(draggedNode)
    const edges = getEdges()
    const nodes = getNodes()

    let best: { edge: Edge; distance: number; handles: { inputHandle: string; outputHandle: string } } | null = null

    for (const edge of edges) {
      // Skip bypass edges
      if ((edge.data as Record<string, unknown>)?._bypassOf) continue

      // Skip edges connected to the dragged node itself
      if (edge.source === draggedNode.id || edge.target === draggedNode.id) continue

      const sourceNode = nodes.find(n => n.id === edge.source) ?? getNode(edge.source)
      const targetNode = nodes.find(n => n.id === edge.target) ?? getNode(edge.target)
      if (!sourceNode || !targetNode) continue

      // Check compatibility before computing distance
      const handles = findSpliceHandles(nodeType, edge.sourceHandle, edge.targetHandle)
      if (!handles) continue

      // Compute distance from node center to edge line segment
      const sp = getHandlePosition(sourceNode, 'source')
      const tp = getHandlePosition(targetNode, 'target')
      const dist = distToSegment(center.x, center.y, sp.x, sp.y, tp.x, tp.y)

      if (dist < PROXIMITY_THRESHOLD && (!best || dist < best.distance)) {
        best = { edge, distance: dist, handles }
      }
    }

    return best
  }, [getEdges, getNodes, getNode])

  const onNodeDrag: OnNodeDrag = useCallback((_event, node) => {
    const result = findNearestCompatibleEdge(node)
    if (result) {
      setHighlight(result.edge.id)
    } else {
      clearHighlight()
    }
  }, [findNearestCompatibleEdge, setHighlight, clearHighlight])

  const tryInsertOnEdge = useCallback((_event: React.MouseEvent, node: Node): boolean => {
    clearHighlight()

    const result = findNearestCompatibleEdge(node)
    if (!result) return false

    const { edge, handles } = result
    const currentNodes = getNodes()
    const currentEdges = getEdges()

    // Remove the old edge
    const filteredEdges = currentEdges.filter(e => e.id !== edge.id)

    // Create two new edges: source → dropped node, dropped node → target
    const edgeIn: Edge = {
      id: `e-${edge.source}-${node.id}-${Date.now()}`,
      source: edge.source,
      sourceHandle: edge.sourceHandle,
      target: node.id,
      targetHandle: handles.inputHandle,
      style: edgeStyle(edge.sourceHandle),
    }

    const edgeOut: Edge = {
      id: `e-${node.id}-${edge.target}-${Date.now()}`,
      source: node.id,
      sourceHandle: handles.outputHandle,
      target: edge.target,
      targetHandle: edge.targetHandle,
      style: edgeStyle(handles.outputHandle),
    }

    // Enforce 1-edge-per-input: remove any existing edges on the target pins before connecting
    let cleanEdges = enforceOneEdgePerInput(filteredEdges, node.id, handles.inputHandle, currentNodes)
    cleanEdges = enforceOneEdgePerInput(cleanEdges, edge.target, edge.targetHandle, currentNodes)
    const postEdges = [...cleanEdges, edgeIn, edgeOut]
    snapshot(currentNodes, postEdges)
    setEdges(postEdges)

    return true
  }, [findNearestCompatibleEdge, getNodes, getEdges, setEdges, snapshot, clearHighlight])

  return { onNodeDrag, tryInsertOnEdge }
}
