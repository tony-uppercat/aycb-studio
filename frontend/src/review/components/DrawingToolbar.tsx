import { useDrawingToolStore } from '../stores/drawingToolStore'

const COLORS = ['#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#F52776']
const SIZES = [2, 4, 8, 16]

export function DrawingToolbar() {
  const { tool, setTool, color, setColor, size, setSize } = useDrawingToolStore()

  return (
    <div className="rh-drawing-toolbar">
      <button
        className={`rh-tool-btn ${tool === 'pen' ? 'active' : ''}`}
        onClick={() => setTool('pen')}
      >
        Pen
      </button>
      <button
        className={`rh-tool-btn ${tool === 'eraser' ? 'active' : ''}`}
        onClick={() => setTool('eraser')}
      >
        Eraser
      </button>
      <div className="rh-toolbar-sep" />
      {COLORS.map((c) => (
        <button
          key={c}
          className={`rh-color-btn ${color === c ? 'active' : ''}`}
          style={{ background: c }}
          onClick={() => setColor(c)}
        />
      ))}
      <div className="rh-toolbar-sep" />
      {SIZES.map((s) => (
        <button
          key={s}
          className={`rh-size-btn ${size === s ? 'active' : ''}`}
          onClick={() => setSize(s)}
        >
          {s}
        </button>
      ))}
    </div>
  )
}
