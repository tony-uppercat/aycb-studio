import type { Edge } from '@xyflow/react'
import { getHandleType } from '../hooks/useDataPropagation'

export const EDGE_COLORS: Record<string, string> = {
  text: '#f59e0b',
  image: '#3b82f6',
  video: '#22c55e',
  prompt: '#a855f7',
  media: '#3b82f6',
}

export function edgeStyle(sourceHandle: string | null | undefined) {
  const type = getHandleType(sourceHandle)
  const color = EDGE_COLORS[type] ?? '#555'
  return { stroke: color, strokeWidth: 2 }
}

/** Apply edge color based on source handle type. Skips bypass edges. */
export function applyEdgeColor(e: Edge): Edge {
  if ((e.data as Record<string, unknown>)?._bypassOf) return e
  const type = getHandleType(e.sourceHandle)
  const color = EDGE_COLORS[type] ?? '#555'
  return { ...e, style: { stroke: color, strokeWidth: 2 } }
}
