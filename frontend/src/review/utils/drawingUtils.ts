/**
 * Smooth a stroke using Bezier curves.
 * Takes array of {x, y, pressure} points, returns smoothed array.
 */
export function smoothStroke(
  points: Array<{ x: number; y: number; pressure?: number }>,
): Array<{ x: number; y: number; pressure?: number }> {
  if (points.length < 3) return points
  const smoothed: typeof points = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]
    smoothed.push({
      x: (prev.x + curr.x * 2 + next.x) / 4,
      y: (prev.y + curr.y * 2 + next.y) / 4,
      pressure: curr.pressure,
    })
  }
  smoothed.push(points[points.length - 1])
  return smoothed
}

/**
 * Map pressure (0-1) to stroke width.
 * Light touch = thin, full press = thick.
 */
export function pressureToWidth(pressure: number, baseWidth: number): number {
  const minFactor = 0.3
  const maxFactor = 2.0
  const factor = minFactor + (maxFactor - minFactor) * Math.pow(pressure, 0.7)
  return baseWidth * factor
}
