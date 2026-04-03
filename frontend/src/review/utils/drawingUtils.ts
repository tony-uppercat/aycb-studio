import type { Stroke } from '../stores/drawingStore'

/**
 * Map pointer pressure (0-1) to a width multiplier.
 * When pressure is 0 (mouse) we treat it as 0.5 for a mid-weight line.
 */
export function pressureToWidth(pressure: number, base: number): number {
  const p = pressure === 0 ? 0.5 : pressure
  return base * (0.4 + p * 1.2)
}

/**
 * Remote cursor color derived from user id hash.
 */
const CURSOR_COLORS = [
  '#ff6b6b', '#48dbfb', '#feca57', '#ff9ff3',
  '#54a0ff', '#5f27cd', '#01a3a4', '#f368e0',
]
export function cursorColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length]
}

/**
 * Draw an arrowhead at the tip of a line segment.
 */
function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

/**
 * Render a single stroke onto a Canvas 2D context.
 * Supports pen, highlighter, eraser, line, and arrow tools
 * with optional pressure-sensitive width variation.
 */
export function renderStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, tool, color, stroke_width, opacity } = stroke
  if (!points || points.length < 1) return

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.lineWidth = stroke_width
  ctx.globalAlpha = tool === 'highlighter' ? opacity * 0.45 : opacity

  if (tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = 'rgba(0,0,0,1)'
  }
  if (tool === 'highlighter') ctx.lineWidth = stroke_width * 4

  // -- Line / Arrow ----------------------------------------------------------
  if (tool === 'line' || tool === 'arrow') {
    if (points.length >= 2) {
      const start = points[0]
      const end = points[points.length - 1]
      ctx.beginPath()
      ctx.moveTo(start.x, start.y)
      ctx.lineTo(end.x, end.y)
      ctx.stroke()
      if (tool === 'arrow') {
        ctx.fillStyle = color
        drawArrowhead(ctx, start, end, Math.max(stroke_width * 3, 12))
      }
    }
    ctx.restore()
    return
  }

  // -- Single dot ------------------------------------------------------------
  if (points.length < 2) {
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle
    ctx.fill()
    ctx.restore()
    return
  }

  // -- Pressure-sensitive segments -------------------------------------------
  const hasPressure = points.some((p) => p.pressure && p.pressure > 0)
  if (hasPressure && tool !== 'eraser') {
    const baseW = tool === 'highlighter' ? stroke_width * 4 : stroke_width
    for (let i = 0; i < points.length - 1; i++) {
      ctx.lineWidth = pressureToWidth(points[i + 1].pressure || 0, baseW)
      ctx.beginPath()
      ctx.moveTo(points[i].x, points[i].y)
      if (i + 2 < points.length) {
        const mx = (points[i + 1].x + points[i + 2].x) / 2
        const my = (points[i + 1].y + points[i + 2].y) / 2
        ctx.quadraticCurveTo(points[i + 1].x, points[i + 1].y, mx, my)
      } else {
        ctx.lineTo(points[i + 1].x, points[i + 1].y)
      }
      ctx.stroke()
    }
  } else {
    // -- Smooth bezier -------------------------------------------------------
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2
      const my = (points[i].y + points[i + 1].y) / 2
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my)
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
    ctx.stroke()
  }
  ctx.restore()
}
