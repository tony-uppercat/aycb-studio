import { useEffect, useCallback, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useCanvasStore } from '../stores/canvasStore'
import { serializeNodes } from './useCanvasPersistence'
import type { PersistedCanvas } from './useCanvasPersistence'
import { STORAGE_KEYS } from '../storage/keys'
import { CANVAS_EVENTS } from '../events/canvasEvents'

const SESSION_START = new Date().toISOString()

const FEEDBACK_KEY = STORAGE_KEYS.FEEDBACK

/**
 * Send a session report (costs + feedback) to the backend.
 * Uses sendBeacon for reliability during page unload.
 * Can also be called manually (e.g. from ConsolePanel Report button).
 */
export function sendSessionReport(): boolean {
  try {
    const costs = useCanvasStore.getState().costs
    let feedback: unknown[] = []
    try {
      feedback = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]')
    } catch { /* ignore */ }

    const payload = {
      costs,
      feedback,
      sessionStart: SESSION_START,
      sessionEnd: new Date().toISOString(),
    }

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    return navigator.sendBeacon('/api/report/session', blob)
  } catch {
    return false
  }
}

/**
 * Extra save triggers on top of the 500ms debounce in useCanvasPersistence:
 *  - Ctrl+S  (manual keyboard shortcut)
 *  - Window blur  (save when switching tabs, only if dirty)
 *  - beforeunload  (best-effort synchronous save on page close)
 *  - 30s checkpoint  (periodic save if dirty)
 *  - aycb-manual-save custom event  (SaveIndicator click)
 */
export function useAutosave(activeProjectId?: string | null) {
  const { getViewport, getNodes, getEdges } = useReactFlow()
  const setSaveStatus = useCanvasStore(s => s.setSaveStatus)
  // Capture projectId in a ref so saves always target THIS tab's project
  const projectIdRef = useRef(activeProjectId)
  projectIdRef.current = activeProjectId

  const saveNow = useCallback(async () => {
    setSaveStatus('saving')
    const viewport = getViewport()
    const payload: PersistedCanvas = {
      nodes: serializeNodes(getNodes()),
      edges: getEdges(),
      viewport,
    }

    // IndexedDB project store (async) — use ref-captured projectId (tab-local)
    const pid = projectIdRef.current
    if (pid) {
      try {
        const { updateProject } = await import('../stores/projectStore')
        await updateProject(pid, { canvas: payload })
        setSaveStatus('saved')
      } catch (err) {
        console.warn('[autosave] IndexedDB failed:', err)
        setSaveStatus('unsaved')
      }
    } else {
      setSaveStatus('unsaved')
    }
  }, [getViewport, getNodes, getEdges, setSaveStatus])

  // Ctrl+S — prevent browser save dialog
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [saveNow])

  // Window blur — save when user switches tabs (only if dirty)
  useEffect(() => {
    const handler = () => {
      if (useCanvasStore.getState().saveStatus === 'unsaved') {
        saveNow()
      }
    }
    window.addEventListener('blur', handler)
    return () => window.removeEventListener('blur', handler)
  }, [saveNow])

  // beforeunload — send session report (survives page close)
  // Note: we accept up to 500ms of work loss on crash (debounce window).
  // The 30s periodic checkpoint is the safety net.
  useEffect(() => {
    const handler = () => {
      sendSessionReport()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Manual save event from SaveIndicator click
  useEffect(() => {
    const handler = () => { saveNow() }
    window.addEventListener(CANVAS_EVENTS.AYCB_MANUAL_SAVE, handler)
    return () => window.removeEventListener(CANVAS_EVENTS.AYCB_MANUAL_SAVE, handler)
  }, [saveNow])

  // Checkpoint every 30s if dirty
  useEffect(() => {
    const interval = setInterval(() => {
      if (useCanvasStore.getState().saveStatus === 'unsaved') {
        saveNow()
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [saveNow])

  return { saveNow }
}
