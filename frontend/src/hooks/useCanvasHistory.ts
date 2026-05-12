/**
 * Undo/Redo system — v2 (rewritten from scratch)
 *
 * EXPLICIT SNAPSHOTS ONLY. No auto-detection, no timing guards, no suppression windows.
 * Every undoable operation must call snapshot() with the POST-mutation state.
 * Node drag is handled via onNodeDragStop (not onNodesChange).
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Node, Edge } from '@xyflow/react'

const MAX_HISTORY = 50

/**
 * Generation outputs that must survive undo/redo. Snapshots are taken before
 * generation completes (or not at all for in-flight ops), so a later undo of
 * an unrelated action would otherwise strip the user's image/video work.
 * On restore, the node's CURRENT value for these keys overrides the snapshot.
 */
const PRESERVED_KEYS = ['mediaId', 'historyIds', 'frameIds', 'result', 'analysisHistory'] as const

interface CanvasSnapshot {
  nodes: Node[]
  edges: Edge[]
}

interface UseCanvasHistoryResult {
  /** Push post-mutation state onto the history stack */
  snapshot: (nodes: Node[], edges: Edge[]) => void
  undo: () => void
  redo: () => void
  /** Replace entire history with a single snapshot (after project load) */
  resetHistory: (nodes: Node[], edges: Edge[]) => void
  /** Call from onNodeDragStop to snapshot after drag */
  onDragStop: () => void
}

export function useCanvasHistory(
  getNodes: () => Node[],
  getEdges: () => Edge[],
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void,
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void,
  initialSnapshot: CanvasSnapshot,
): UseCanvasHistoryResult {
  const historyRef = useRef<CanvasSnapshot[]>([initialSnapshot])
  const idxRef = useRef(0)
  const restoringRef = useRef(false)

  function snapshot(n: Node[], e: Edge[]): void {
    // Skip if we're currently restoring (undo/redo triggers React Flow changes)
    if (restoringRef.current) return
    // Keys whose values can be extremely large (base64 images, analysis results).
    // Same set stripped by serializeNodes() for persistence.
    const HEAVY_KEYS = new Set(['result', 'analysisHistory'])
    const lightNodes = n.map(node => ({
      ...node,
      position: { ...node.position }, // Deep copy — React Flow may mutate in place
      data: Object.fromEntries(
        Object.entries(node.data as Record<string, unknown>).filter(([k, v]) => {
          if (v instanceof File) return false
          if (HEAVY_KEYS.has(k)) return false
          if (typeof v === 'string' && v.startsWith('blob:')) return false
          return true
        })
      )
    }))
    const stack = historyRef.current.slice(0, idxRef.current + 1)
    stack.push({ nodes: lightNodes, edges: e })
    if (stack.length > MAX_HISTORY) stack.shift()
    historyRef.current = stack
    idxRef.current = stack.length - 1
  }

  const restore = useCallback((index: number): void => {
    restoringRef.current = true
    idxRef.current = index
    const { nodes: snapNodes, edges: e } = historyRef.current[index]
    // Merge: restore positions/edges/settings from snapshot, but keep the
    // current node's generation outputs (mediaId, historyIds, etc.) so that
    // undoing an unrelated action doesn't wipe images the user just made.
    const currentById = new Map(getNodes().map(n => [n.id, n]))
    const merged = snapNodes.map(snap => {
      const cur = currentById.get(snap.id)
      if (!cur) return snap
      const curData = cur.data as Record<string, unknown>
      const data: Record<string, unknown> = { ...(snap.data as Record<string, unknown>) }
      for (const key of PRESERVED_KEYS) {
        if (key in curData) data[key] = curData[key]
      }
      return { ...snap, data }
    })
    setNodes(merged)
    setEdges(e)
    // Allow React Flow to settle, then unlock
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { restoringRef.current = false })
    })
  }, [setNodes, setEdges, getNodes])

  const undo = useCallback((): void => {
    if (idxRef.current > 0) restore(idxRef.current - 1)
  }, [restore])

  const redo = useCallback((): void => {
    if (idxRef.current < historyRef.current.length - 1) restore(idxRef.current + 1)
  }, [restore])

  const resetHistory = useCallback((n: Node[], e: Edge[]): void => {
    historyRef.current = [{ nodes: n, edges: e }]
    idxRef.current = 0
    restoringRef.current = false
  }, [])

  /** Snapshot current state after a node drag ends (1-frame delay for React Flow to settle) */
  const onDragStop = useCallback((): void => {
    if (restoringRef.current) return
    requestAnimationFrame(() => {
      if (!restoringRef.current) snapshot(getNodes(), getEdges())
    })
  }, [getNodes, getEdges])

  // Keyboard: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (mod && (e.key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  return { snapshot, undo, redo, resetHistory, onDragStop }
}
