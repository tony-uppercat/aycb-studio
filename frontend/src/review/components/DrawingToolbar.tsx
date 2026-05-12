import { useCallback, useState } from 'react'
import { useDrawingStore } from '../stores/drawingStore'
import { useUserStore } from '../stores/userStore'
import { rhApi } from '../services/api'
import { toast } from '../stores/toastStore'

interface DrawingToolbarProps {
  mediaId: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f97316',
  '#eab308', '#a855f7', '#ffffff', '#000000',
]

const BRUSH_SIZES = [1, 3, 5, 10, 20]

const TOOLS = [
  { id: 'pen',         label: 'Pen' },
  { id: 'highlighter', label: 'Highlight' },
  { id: 'eraser',      label: 'Eraser' },
  { id: 'line',        label: 'Line' },
  { id: 'arrow',       label: 'Arrow' },
]

// ─── DrawingToolbar ───────────────────────────────────────────────────────────

export default function DrawingToolbar({ mediaId }: DrawingToolbarProps) {
  const {
    current_tool, color, stroke_width, opacity,
    strokes, undo_stack, drawing_visible,
    setTool, setColor, setStrokeWidth, setOpacity,
    toggleVisibility, undo, redo, clearAll, toggleDrawingMode,
  } = useDrawingStore()
  const user_name = useUserStore(s => s.user_name) || 'Anonymous'

  const [clear_confirm, setClearConfirm] = useState(false)

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    if (clear_confirm) {
      clearAll()
      setClearConfirm(false)
    } else {
      setClearConfirm(true)
    }
  }, [clear_confirm, clearAll])

  // Save current strokes. Reads strokes imperatively so the handler
  // identity doesn't change on every stroke — keeping click latency flat
  // even during an active pen session.
  const handleSave = useCallback(async () => {
    const all = useDrawingStore.getState().strokes
    try {
      await rhApi.saveDrawing({
        media_id: mediaId, author: user_name,
        strokes_json: JSON.stringify(all),
      })
      toast.success('Drawing saved')
    } catch (err) {
      toast.error(`Drawing save failed: ${err instanceof Error ? err.message : err}`)
    }
  }, [mediaId, user_name])

  const handleOpacity = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setOpacity(Number(e.target.value))
    },
    [setOpacity],
  )

  const handleCustomColor = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setColor(e.target.value)
    },
    [setColor],
  )

  // Dismiss confirm if user does anything else
  const resetConfirm = useCallback(() => {
    if (clear_confirm) setClearConfirm(false)
  }, [clear_confirm])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rh-dt" onClick={resetConfirm}>

      {/* Tool buttons */}
      <div className="rh-dt-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`rh-dt-btn${current_tool === t.id ? ' rh-dt-btn--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setTool(t.id) }}
            title={t.label}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rh-dt-sep" />

      {/* Color swatches + custom picker */}
      <div className="rh-dt-group">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            className={`rh-dt-swatch${color === c ? ' rh-dt-swatch--active' : ''}`}
            style={{ background: c }}
            onClick={(e) => { e.stopPropagation(); setColor(c) }}
            title={c}
          />
        ))}
        <input
          type="color"
          className="rh-dt-color-input"
          value={color}
          onChange={handleCustomColor}
          title="Custom color"
        />
      </div>

      <div className="rh-dt-sep" />

      {/* Brush sizes — proportional dots */}
      <div className="rh-dt-group">
        {BRUSH_SIZES.map((s) => (
          <button
            key={s}
            className={`rh-dt-size${stroke_width === s ? ' rh-dt-size--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setStrokeWidth(s) }}
            title={`${s}px`}
          >
            <span
              className="rh-dt-dot"
              style={{
                width:  `${Math.max(4, Math.min(s * 1.2, 22))}px`,
                height: `${Math.max(4, Math.min(s * 1.2, 22))}px`,
              }}
            />
          </button>
        ))}
      </div>

      <div className="rh-dt-sep" />

      {/* Opacity slider */}
      <div className="rh-dt-group">
        <span className="rh-dt-opacity-label">{Math.round(opacity * 100)}%</span>
        <input
          type="range"
          className="rh-dt-slider"
          min={0.1}
          max={1}
          step={0.05}
          value={opacity}
          onChange={handleOpacity}
          title="Opacity"
        />
      </div>

      <div className="rh-dt-sep" />

      {/* Undo / Redo */}
      <div className="rh-dt-group">
        <button
          className="rh-dt-btn"
          onClick={(e) => { e.stopPropagation(); undo() }}
          disabled={strokes.length === 0}
          style={{ opacity: strokes.length === 0 ? 0.35 : 1 }}
          title="Undo"
        >
          Undo
        </button>
        <button
          className="rh-dt-btn"
          onClick={(e) => { e.stopPropagation(); redo() }}
          disabled={undo_stack.length === 0}
          style={{ opacity: undo_stack.length === 0 ? 0.35 : 1 }}
          title="Redo"
        >
          Redo
        </button>
      </div>

      <div className="rh-dt-sep" />

      {/* Visibility toggle */}
      <button
        className={`rh-dt-btn${!drawing_visible ? ' rh-dt-btn--muted' : ''}`}
        onClick={(e) => { e.stopPropagation(); toggleVisibility() }}
        title={drawing_visible ? 'Hide drawings' : 'Show drawings'}
      >
        {drawing_visible ? 'Visible' : 'Hidden'}
      </button>

      <div className="rh-dt-sep" />

      {/* Actions */}
      <div className="rh-dt-group">
        <button
          className={`rh-dt-btn${clear_confirm ? ' rh-dt-btn--danger' : ''}`}
          onClick={(e) => { e.stopPropagation(); handleClear() }}
          title="Clear all drawings"
        >
          {clear_confirm ? 'Sure?' : 'Clear'}
        </button>
        <button
          className="rh-dt-btn rh-dt-btn--save"
          onClick={(e) => { e.stopPropagation(); handleSave() }}
          title="Save drawings"
        >
          Save
        </button>
        <button
          className="rh-dt-btn rh-dt-btn--close"
          onClick={(e) => { e.stopPropagation(); toggleDrawingMode() }}
          title="Exit drawing mode"
        >
          Close
        </button>
      </div>
    </div>
  )
}
