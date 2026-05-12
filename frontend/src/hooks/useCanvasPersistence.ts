import { useEffect, useRef } from 'react'
import type { Node, Edge, Viewport } from '@xyflow/react'
import { useReactFlow } from '@xyflow/react'


import { useCanvasStore } from '../stores/canvasStore'
import { applyEdgeColor } from '../utils/edgeStyles'

export interface PersistedCanvas {
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
}

/**
 * Keys added by React Flow internals that should NOT be persisted.
 * These are transient layout/interaction state, not user data.
 */
const RF_INTERNAL_KEYS = new Set([
  'measured', 'selected', 'dragging', 'resizing', 'draggable',
  'selectable', 'connectable', 'deletable', 'focusable',
])

/**
 * Data keys whose values can be extremely large (e.g. embedded base64 images)
 * and are NOT needed to reconstruct the canvas — media is stored in IndexedDB
 * by mediaId.  Stripping these keeps serialized payloads lean.
 *
 *  - `result` / `analysisHistory`: runtime outputs of regular nodes.
 *  - `last_preview_b64`: cached base64 thumbnail rendered on a subnet node;
 *    re-derived at runtime, never user-authored.
 */
const LARGE_DATA_KEYS = new Set(['result', 'analysisHistory', 'last_preview_b64'])

/**
 * Strip non-serializable values and transient React Flow properties from nodes
 * before saving to IndexedDB / exporting to JSON.
 *
 *  - File objects and blob: URLs → removed (media lives in IndexedDB via mediaId)
 *  - React Flow internal keys (measured, selected, …) → removed
 *  - Large embedded-data keys (result, analysisHistory, last_preview_b64) → removed
 *  - Functions, Symbols, undefined → removed (not JSON-serializable)
 *  - Subnet nodes: `data.sub_graph.nodes` recursed through serializeNodes so
 *    nested children are cleaned the same way. `edges`/`viewport` passed through
 *    unchanged (already plain data). `external_inputs`/`external_outputs` stay.
 */
export function serializeNodes(nodes: Node[]): Node[] {
  return nodes.map(n => {
    // Build clean node without RF internal keys
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(n)) {
      if (RF_INTERNAL_KEYS.has(k)) continue
      if (k === 'data') continue // handled below
      clean[k] = v
    }

    // Build clean data without non-serializable / oversized entries
    const data: Record<string, unknown> = {}
    const raw_data = (n.data ?? {}) as Record<string, unknown>
    for (const [k, v] of Object.entries(raw_data)) {
      if (v instanceof File) continue
      if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'undefined') continue
      if (typeof v === 'string' && v.startsWith('blob:')) continue
      if (LARGE_DATA_KEYS.has(k)) continue
      data[k] = v
    }

    // Recurse into nested sub_graph for subnet containers so File objects and
    // runtime keys inside nested children are stripped at every depth.
    if (n.type === 'subnet') {
      const raw_sg = raw_data.sub_graph
      const sg = (raw_sg && typeof raw_sg === 'object')
        ? raw_sg as { nodes?: unknown; edges?: unknown; viewport?: unknown }
        : null
      if (sg) {
        const nested_nodes = Array.isArray(sg.nodes) ? (sg.nodes as Node[]) : []
        data.sub_graph = {
          nodes: serializeNodes(nested_nodes),
          edges: Array.isArray(sg.edges) ? sg.edges : [],
          viewport: sg.viewport ?? { x: 0, y: 0, zoom: 1 },
        }
      }
    }

    clean.data = data
    return clean as Node
  })
}

/**
 * Load the default project from public/default-project.json on first visit.
 * Restores media into IndexedDB and returns canvas data.
 */
export async function loadDefaultProject(): Promise<PersistedCanvas | null> {
  try {
    const resp = await fetch('/default-project.json')
    if (!resp.ok) return null
    const project = await resp.json()
    if (project.version !== 1) return null

    // Restore media into IndexedDB
    const { saveMedia } = await import('../mediaStore')
    for (const item of project.media ?? []) {
      try {
        const binary = atob(item.dataB64)
        const buf = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
        const blob = new Blob([buf], { type: item.type })
        const file = new File([blob], item.name, { type: item.type })
        await saveMedia(item.id, file)
      } catch { /* skip broken entries */ }
    }

    const edges = (project.canvas.edges ?? []).map((e: Edge) => applyEdgeColor(e))
    return {
      nodes: project.canvas.nodes ?? [],
      edges,
      viewport: project.canvas.viewport,
    }
  } catch {
    return null
  }
}

const BACKUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Save canvas to IndexedDB (sole source of truth for multi-project support).
 * Also backs up to disk via POST /api/canvas/backup every 5 minutes.
 * Debounced at 500ms.
 */
export function useCanvasPersistence(nodes: Node[], edges: Edge[], activeProjectId?: string | null): void {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { getViewport, getNodes, getEdges } = useReactFlow()
  const setSaveStatus = useCanvasStore(s => s.setSaveStatus)
  // Capture projectId in a ref so the debounced callback always uses the value
  // from THIS tab's React state, never from a global key.
  const projectIdRef = useRef(activeProjectId)
  projectIdRef.current = activeProjectId

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

    // Skip the Zustand set entirely if already 'unsaved' — avoids state merge +
    // subscriber notifications on every React Flow internal node update.
    if (useCanvasStore.getState().saveStatus !== 'unsaved') setSaveStatus('unsaved')

    saveTimerRef.current = setTimeout(() => {
      setSaveStatus('saving')

      const viewport = getViewport()
      const payload: PersistedCanvas = {
        nodes: serializeNodes(getNodes()),
        edges: getEdges(),
        viewport,
      }

      // Save to IndexedDB project store (async, non-blocking)
      // Use the ref-captured projectId (tab-local)
      const pid = projectIdRef.current
      if (pid) {
        import('../stores/projectStore').then(async ({ updateProject }) => {
          try {
            await updateProject(pid, { canvas: payload })
            setSaveStatus('saved')
          } catch (err) {
            console.warn('[AYCB] IndexedDB project save failed:', err)
            setSaveStatus('unsaved')
          }
        })
      } else {
        setSaveStatus('unsaved')
      }
    }, 500)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [nodes, edges, getViewport, getNodes, getEdges, setSaveStatus])

  // Disk backup: POST canvas to backend every 5 minutes
  useEffect(() => {
    if (!activeProjectId) return

    const doBackup = () => {
      const pid = projectIdRef.current
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
      }).catch(err => console.warn('[AYCB] Canvas disk backup failed:', err))
    }

    backupTimerRef.current = setInterval(doBackup, BACKUP_INTERVAL_MS)
    return () => {
      if (backupTimerRef.current) clearInterval(backupTimerRef.current)
    }
  }, [activeProjectId, getNodes, getEdges, getViewport])
}

/**
 * Rewrite legacy handle ids on a single edge.
 *
 * Renamed handles past the rename leave dangling references in saved canvases —
 * React Flow logs error #008 every render until they're fixed.
 *
 *  - `prompt-out` → `text-out`   (text-input output rename)
 *  - `image-out-1` → `image-out` (generate-image / image-fx single-output rename)
 */
function migrateEdge(e: Edge): Edge {
  let next = e
  if (next.sourceHandle === 'prompt-out') next = { ...next, sourceHandle: 'text-out' }
  if (next.sourceHandle === 'image-out-1') next = { ...next, sourceHandle: 'image-out' }
  return next
}

/**
 * Recursively migrate a node's nested sub_graph (subnet container only).
 * Top-level nodes pass through unchanged.
 */
function migrateNodeSubGraph(n: Node): Node {
  if (n.type !== 'subnet') return n
  const data = (n.data ?? {}) as Record<string, unknown>
  const sg = data.sub_graph as { nodes?: Node[]; edges?: Edge[]; viewport?: unknown } | undefined
  if (!sg) return n
  const inner_nodes = Array.isArray(sg.nodes) ? sg.nodes.map(migrateNodeSubGraph) : []
  const inner_edges = Array.isArray(sg.edges)
    ? sg.edges.map((e) => applyEdgeColor(migrateEdge(e)))
    : []
  return {
    ...n,
    data: { ...data, sub_graph: { ...sg, nodes: inner_nodes, edges: inner_edges } },
  }
}

/**
 * Load canvas from IndexedDB project store.
 * Also runs migration from localStorage → IndexedDB on first use.
 * Returns null if no project found (caller handles the default).
 */
export async function loadCanvasAsync(): Promise<PersistedCanvas | null> {
  const { getActiveProjectId, getProject, migrateFromLocalStorage } = await import('../stores/projectStore')

  // Try migration first (runs once if localStorage canvas exists)
  let projectId = await getActiveProjectId()
  if (!projectId) {
    const migratedId = await migrateFromLocalStorage()
    if (migratedId) {
      projectId = migratedId
    }
  }

  // Load from IndexedDB
  if (projectId) {
    const project = await getProject(projectId)
    if (project?.canvas) {
      const canvas = project.canvas
      if (Array.isArray(canvas.edges)) {
        canvas.edges = canvas.edges.map((e: Edge) => applyEdgeColor(migrateEdge(e)))
      }
      if (Array.isArray(canvas.nodes)) {
        canvas.nodes = canvas.nodes.map(migrateNodeSubGraph)
      }
      return canvas
    }
  }

  return null
}
