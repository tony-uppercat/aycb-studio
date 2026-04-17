import { useRef, useEffect, useCallback } from 'react'
import { useDrawingStore, type Stroke } from '../stores/drawingStore'
import { emitEvent } from '../services/socket'
import { rhApi } from '../services/api'
import { useUserStore } from '../stores/userStore'
import { renderStroke, cursorColor } from '../utils/drawingUtils'
import { toast } from '../stores/toastStore'

// ---------------------------------------------------------------------------
// DrawingCanvas -- dual-canvas freehand drawing with pressure sensitivity,
// bezier smoothing, line/arrow tools, and real-time collaboration.
// ---------------------------------------------------------------------------

interface DrawingCanvasProps {
  mediaId: number
  imageWidth?: number
  imageHeight?: number
}

const THROTTLE_MS = 1000 / 60

export function DrawingCanvas({ mediaId, imageWidth, imageHeight }: DrawingCanvasProps) {
  const localRef = useRef<HTMLCanvasElement>(null)
  const remoteRef = useRef<HTMLCanvasElement>(null)
  const pathRef = useRef<{ x: number; y: number; pressure?: number }[]>([])
  const downRef = useRef(false)
  const rafRef = useRef(0)
  const lastEmitRef = useRef(0)
  const lineStartRef = useRef<{ x: number; y: number } | null>(null)
  const lineEndRef = useRef<{ x: number; y: number } | null>(null)
  const redrawLocalRef = useRef<() => void>(() => {})

  const {
    current_tool, color, stroke_width, opacity,
    strokes, remote_strokes, remote_cursors, drawing_visible,
    addStroke, undo, redo,
  } = useDrawingStore()
  const user_name = useUserStore((s) => s.user_name) || 'Anonymous'

  const w = imageWidth || 1920
  const h = imageHeight || 1080

  // -- Canvas coordinate helper -----------------------------------------------
  const getPos = useCallback((e: PointerEvent | React.PointerEvent) => {
    const c = localRef.current
    if (!c) return { x: 0, y: 0, pressure: 0 }
    const r = c.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
      pressure: e.pressure || 0,
    }
  }, [])

  // -- Redraw helpers ---------------------------------------------------------
  const redrawLocal = useCallback(() => {
    const c = localRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    strokes.forEach((s) => renderStroke(ctx, s))

    // In-progress preview
    const tool = current_tool
    if ((tool === 'line' || tool === 'arrow') && lineStartRef.current && lineEndRef.current) {
      renderStroke(ctx, {
        id: '_preview', tool, color, stroke_width, opacity,
        points: [lineStartRef.current, lineEndRef.current],
      })
    } else if (pathRef.current.length > 1) {
      renderStroke(ctx, {
        id: '_preview', tool, color, stroke_width, opacity,
        points: pathRef.current,
      })
    }
  }, [strokes, current_tool, color, stroke_width, opacity])

  const redrawRemote = useCallback(() => {
    const c = remoteRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    remote_strokes.forEach((s) => renderStroke(ctx, s))
  }, [remote_strokes])

  redrawLocalRef.current = redrawLocal
  useEffect(() => { redrawLocal() }, [redrawLocal])
  useEffect(() => { redrawRemote() }, [redrawRemote])

  // -- Keyboard shortcuts (undo/redo) ----------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); redo() }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  // -- Auto-save after each stroke (backend upserts, notify on save) -----------
  const scheduleAutoSave = useCallback(() => {
    const all = useDrawingStore.getState().strokes
    if (all.length === 0) return
    rhApi.saveDrawing({
      media_id: mediaId, author: user_name, strokes_json: JSON.stringify(all),
    })
      .then(() => toast.success('Drawing saved'))
      .catch(e => toast.error(`Drawing save failed: ${e instanceof Error ? e.message : e}`))
  }, [mediaId, user_name])

  // -- Stroke ID helper -------------------------------------------------------
  const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // -- Pointer handlers -------------------------------------------------------
  const onDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    localRef.current?.setPointerCapture(e.pointerId)
    const pt = getPos(e)
    downRef.current = true

    if (current_tool === 'line' || current_tool === 'arrow') {
      lineStartRef.current = pt
      lineEndRef.current = pt
      return
    }
    pathRef.current = [pt]
  }, [getPos, current_tool])

  const onMove = useCallback((e: React.PointerEvent) => {
    const pos = getPos(e)
    const now = performance.now()
    if (now - lastEmitRef.current > THROTTLE_MS) {
      emitEvent('cursor_move', { x: pos.x, y: pos.y, user_id: user_name })
      lastEmitRef.current = now
    }
    if (!downRef.current) return
    e.preventDefault()

    if (current_tool === 'line' || current_tool === 'arrow') {
      lineEndRef.current = pos
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; redrawLocal() })
      }
      return
    }

    // Coalesced events for Apple Pencil smoothness
    const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent]
    for (const ce of events) pathRef.current.push(getPos(ce as PointerEvent))

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; redrawLocalRef.current() })
    }
  }, [getPos, current_tool, user_name])

  const onUp = useCallback((e: React.PointerEvent) => {
    if (!downRef.current) return
    e.preventDefault()
    downRef.current = false

    if ((current_tool === 'line' || current_tool === 'arrow') && lineStartRef.current && lineEndRef.current) {
      const stroke: Stroke = {
        id: makeId(), tool: current_tool, color, stroke_width, opacity,
        points: [lineStartRef.current, lineEndRef.current], author: user_name,
      }
      addStroke(stroke)
      // Immediate canvas render — don't wait for React useEffect cycle
      const c = localRef.current
      if (c) renderStroke(c.getContext('2d')!, stroke)
      emitEvent('drawing_stroke', stroke)
      scheduleAutoSave()
      lineStartRef.current = null
      lineEndRef.current = null
      return
    }

    if (pathRef.current.length >= 2) {
      const stroke: Stroke = {
        id: makeId(), tool: current_tool, color, stroke_width, opacity,
        points: pathRef.current, author: user_name,
      }
      addStroke(stroke)
      // Immediate canvas render — don't wait for React useEffect cycle
      const c = localRef.current
      if (c) {
        const ctx = c.getContext('2d')!
        ctx.clearRect(0, 0, c.width, c.height)
        useDrawingStore.getState().strokes.forEach(s => renderStroke(ctx, s))
      }
      emitEvent('drawing_stroke', stroke)
      scheduleAutoSave()
    }
    pathRef.current = []
  }, [current_tool, color, stroke_width, opacity, user_name, addStroke, scheduleAutoSave])

  // -- Load existing drawings on mount ----------------------------------------
  useEffect(() => {
    const ctrl = new AbortController()
    useDrawingStore.getState().resetForMedia()
    rhApi.getDrawing(mediaId, ctrl.signal)
      .then((data) => {
        if (ctrl.signal.aborted) return
        const rec = (data as { drawing?: { strokes_json?: string } | null })?.drawing
        if (rec?.strokes_json) {
          const parsed = JSON.parse(rec.strokes_json) as Stroke[]
          if (Array.isArray(parsed)) {
            parsed.forEach((s) => useDrawingStore.getState().addRemoteStroke(s))
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') console.warn('[DrawingCanvas] load failed:', err)
      })
    return () => { ctrl.abort() }
  }, [mediaId])

  // -- Cleanup on unmount -----------------------------------------------------
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  // -- Render -----------------------------------------------------------------
  const wrapStyle: React.CSSProperties = drawing_visible
    ? {} : { opacity: 0, pointerEvents: 'none' }

  return (
    <div className="rh-drawing-wrap" style={wrapStyle}>
      <canvas ref={remoteRef} className="rh-drawing-remote" width={w} height={h} />
      <canvas
        ref={localRef}
        width={w}
        height={h}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{ touchAction: 'none' }}
      />
      {Object.entries(remote_cursors).map(([uid, pos]) => {
        if (uid === user_name) return null
        const c = localRef.current
        const rect = c?.getBoundingClientRect()
        const sx = rect ? rect.width / w : 1
        const sy = rect ? rect.height / h : 1
        return (
          <div key={uid} className="rh-drawing-cursor" style={{ left: pos.x * sx, top: pos.y * sy }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: cursorColor(uid) }} />
            <span className="rh-drawing-cursor-label">{uid}</span>
          </div>
        )
      })}
    </div>
  )
}
