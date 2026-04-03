import { useState, useRef, useCallback, useMemo } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_BOX_PX = 8

const ANNOTATION_COLORS = [
  '#3b82f6', '#eab308', '#22c55e', '#ef4444',
  '#a855f7', '#f97316', '#14b8a6', '#ec4899',
]

function cycleColor(index: number): string {
  return ANNOTATION_COLORS[index % ANNOTATION_COLORS.length]
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Annotation {
  id: number
  x_position: number
  y_position: number
  annotation_type: string
  box_width?: number
  box_height?: number
  content?: string
  author?: string
}

interface AnnotationCanvasProps {
  media_id: number
  annotations: Annotation[]
  on_add_annotation: (annotation: {
    x: number
    y: number
    width?: number
    height?: number
    type: 'pin' | 'box'
  }) => void
  on_annotation_click: (id: number) => void
  selected_id?: number
}

interface NormCoord { x: number; y: number }

// ─── AnnotationCanvas ─────────────────────────────────────────────────────────

export default function AnnotationCanvas({
  annotations = [],
  on_add_annotation,
  on_annotation_click,
  selected_id,
}: AnnotationCanvasProps) {
  const ref = useRef<HTMLDivElement>(null)

  const [drag_start, setDragStart] = useState<NormCoord | null>(null)
  const [drag_current, setDragCurrent] = useState<NormCoord | null>(null)
  const [is_dragging, setIsDragging] = useState(false)

  const [hovered, setHovered] = useState<Annotation | null>(null)
  const [tooltip_pos, setTooltipPos] = useState({ x: 0, y: 0 })

  // ── Coordinate helpers ────────────────────────────────────────────────────

  const toNorm = useCallback((clientX: number, clientY: number): NormCoord => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    }
  }, [])

  // ── Pointer handlers ──────────────────────────────────────────────────────

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.target !== ref.current) return
      e.preventDefault()
      const norm = toNorm(e.clientX, e.clientY)
      setDragStart(norm)
      setDragCurrent(norm)
      setIsDragging(true)
    },
    [toNorm],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!is_dragging) return
      e.preventDefault()
      setDragCurrent(toNorm(e.clientX, e.clientY))
    },
    [is_dragging, toNorm],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!is_dragging || !drag_start) {
        setIsDragging(false)
        return
      }
      e.preventDefault()

      const end = toNorm(e.clientX, e.clientY)
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) {
        setIsDragging(false); setDragStart(null); setDragCurrent(null)
        return
      }

      const dx_px = Math.abs((end.x - drag_start.x) * rect.width)
      const dy_px = Math.abs((end.y - drag_start.y) * rect.height)

      if (dx_px < MIN_BOX_PX && dy_px < MIN_BOX_PX) {
        on_add_annotation({ type: 'pin', x: drag_start.x, y: drag_start.y })
      } else {
        const x1 = Math.min(drag_start.x, end.x)
        const y1 = Math.min(drag_start.y, end.y)
        on_add_annotation({
          type: 'box',
          x: x1,
          y: y1,
          width: Math.abs(end.x - drag_start.x),
          height: Math.abs(end.y - drag_start.y),
        })
      }

      setIsDragging(false); setDragStart(null); setDragCurrent(null)
    },
    [is_dragging, drag_start, toNorm, on_add_annotation],
  )

  const onPointerLeave = useCallback(() => {
    if (is_dragging) {
      setIsDragging(false); setDragStart(null); setDragCurrent(null)
    }
  }, [is_dragging])

  // ── Drag preview ──────────────────────────────────────────────────────────

  const drag_preview = useMemo(() => {
    if (!is_dragging || !drag_start || !drag_current) return null
    const x1 = Math.min(drag_start.x, drag_current.x)
    const y1 = Math.min(drag_start.y, drag_current.y)
    const w = Math.abs(drag_current.x - drag_start.x)
    const h = Math.abs(drag_current.y - drag_start.y)
    const rect = ref.current?.getBoundingClientRect()
    if (rect && w * rect.width < MIN_BOX_PX && h * rect.height < MIN_BOX_PX) return null
    return {
      left: `${x1 * 100}%`, top: `${y1 * 100}%`,
      width: `${w * 100}%`, height: `${h * 100}%`,
    }
  }, [is_dragging, drag_start, drag_current])

  // ── Hover handlers ────────────────────────────────────────────────────────

  const onAnnEnter = useCallback((e: React.MouseEvent, ann: Annotation) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setHovered(ann)
    setTooltipPos({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top - 8 })
  }, [])

  const onAnnLeave = useCallback(() => setHovered(null), [])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={ref}
      className="rh-annotation-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
    >
      {annotations.map((ann, idx) => {
        const is_selected = selected_id === ann.id
        const clr = cycleColor(idx)
        const is_pin = ann.annotation_type === 'pin'

        if (is_pin) {
          return (
            <div
              key={ann.id}
              className={`rh-annotation-pin${is_selected ? ' rh-annotation-pin--selected' : ''}`}
              style={{
                left: `${ann.x_position * 100}%`,
                top: `${ann.y_position * 100}%`,
                background: is_selected ? undefined : clr,
              }}
              onClick={(e) => { e.stopPropagation(); on_annotation_click(ann.id) }}
              onMouseEnter={(e) => onAnnEnter(e, ann)}
              onMouseLeave={onAnnLeave}
              role="button"
              tabIndex={0}
            >
              {idx + 1}
            </div>
          )
        }

        return (
          <div
            key={ann.id}
            className={`rh-annotation-box${is_selected ? ' rh-annotation-box--selected' : ''}`}
            style={{
              left: `${ann.x_position * 100}%`,
              top: `${ann.y_position * 100}%`,
              width: `${(ann.box_width ?? 0) * 100}%`,
              height: `${(ann.box_height ?? 0) * 100}%`,
              borderColor: is_selected ? undefined : clr,
              background: is_selected ? undefined : `${clr}1a`,
            }}
            onClick={(e) => { e.stopPropagation(); on_annotation_click(ann.id) }}
            onMouseEnter={(e) => onAnnEnter(e, ann)}
            onMouseLeave={onAnnLeave}
            role="button"
            tabIndex={0}
          >
            <span className={`rh-annotation-box-label${is_selected ? ' rh-annotation-box-label--selected' : ''}`}>
              {idx + 1}
            </span>
          </div>
        )
      })}

      {drag_preview && <div className="rh-annotation-drag-preview" style={drag_preview} />}

      {hovered && (
        <div className="rh-annotation-tooltip" style={{ left: tooltip_pos.x, top: tooltip_pos.y }}>
          {hovered.author && <div className="rh-annotation-tooltip-author">{hovered.author}</div>}
          <div>{hovered.content ?? 'Click to open thread'}</div>
        </div>
      )}
    </div>
  )
}
