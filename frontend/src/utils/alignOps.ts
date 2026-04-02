import type { Node } from '@xyflow/react'

export type PositionMap = Record<string, { x?: number; y?: number }>

const GAP = 20

export function nodeW(n: Node): number {
  return n.measured?.width ?? (n.width as number | undefined) ?? 200
}

export function nodeH(n: Node): number {
  return n.measured?.height ?? (n.height as number | undefined) ?? 150
}

export function alignLeft(nodes: Node[]): PositionMap {
  const minX = Math.min(...nodes.map(n => n.position.x))
  return Object.fromEntries(nodes.map(n => [n.id, { x: minX }]))
}

export function alignHCenter(nodes: Node[]): PositionMap {
  const cx = nodes.reduce((s, n) => s + n.position.x + nodeW(n) / 2, 0) / nodes.length
  return Object.fromEntries(nodes.map(n => [n.id, { x: cx - nodeW(n) / 2 }]))
}

export function alignRight(nodes: Node[]): PositionMap {
  const maxRight = Math.max(...nodes.map(n => n.position.x + nodeW(n)))
  return Object.fromEntries(nodes.map(n => [n.id, { x: maxRight - nodeW(n) }]))
}

export function distributeH(nodes: Node[]): PositionMap {
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x)
  const left = sorted[0].position.x
  const right = sorted[sorted.length - 1].position.x + nodeW(sorted[sorted.length - 1])
  const totalW = sorted.reduce((s, n) => s + nodeW(n), 0)
  // With exactly 2 nodes, space = (right - left - totalW) / 1, which keeps
  // the outer edges in place — a no-op. This is intentional correct behavior.
  const space = sorted.length > 1 ? (right - left - totalW) / (sorted.length - 1) : 0
  let cursor = left
  return Object.fromEntries(
    sorted.map(n => {
      const x = cursor
      cursor += nodeW(n) + space
      return [n.id, { x }]
    }),
  )
}

export function alignTop(nodes: Node[]): PositionMap {
  const minY = Math.min(...nodes.map(n => n.position.y))
  return Object.fromEntries(nodes.map(n => [n.id, { y: minY }]))
}

export function alignVCenter(nodes: Node[]): PositionMap {
  const cy = nodes.reduce((s, n) => s + n.position.y + nodeH(n) / 2, 0) / nodes.length
  return Object.fromEntries(nodes.map(n => [n.id, { y: cy - nodeH(n) / 2 }]))
}

export function alignBottom(nodes: Node[]): PositionMap {
  const maxBottom = Math.max(...nodes.map(n => n.position.y + nodeH(n)))
  return Object.fromEntries(nodes.map(n => [n.id, { y: maxBottom - nodeH(n) }]))
}

export function distributeV(nodes: Node[]): PositionMap {
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y)
  const top = sorted[0].position.y
  const bottom = sorted[sorted.length - 1].position.y + nodeH(sorted[sorted.length - 1])
  const totalH = sorted.reduce((s, n) => s + nodeH(n), 0)
  // With exactly 2 nodes, space = (bottom - top - totalH) / 1, which keeps
  // the outer edges in place — a no-op. This is intentional correct behavior.
  const space = sorted.length > 1 ? (bottom - top - totalH) / (sorted.length - 1) : 0
  let cursor = top
  return Object.fromEntries(
    sorted.map(n => {
      const y = cursor
      cursor += nodeH(n) + space
      return [n.id, { y }]
    }),
  )
}

export function stackH(nodes: Node[]): PositionMap {
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x)
  let cursor = sorted[0].position.x
  return Object.fromEntries(
    sorted.map(n => {
      const x = cursor
      cursor += nodeW(n) + GAP
      return [n.id, { x }]
    }),
  )
}

export function stackV(nodes: Node[]): PositionMap {
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y)
  let cursor = sorted[0].position.y
  return Object.fromEntries(
    sorted.map(n => {
      const y = cursor
      cursor += nodeH(n) + GAP
      return [n.id, { y }]
    }),
  )
}

export function autoArrange(nodes: Node[]): PositionMap {
  const cols = Math.ceil(Math.sqrt(nodes.length))
  const sorted = [...nodes].sort((a, b) =>
    a.position.y !== b.position.y ? a.position.y - b.position.y : a.position.x - b.position.x,
  )
  const startX = Math.min(...nodes.map(n => n.position.x))
  const startY = Math.min(...nodes.map(n => n.position.y))
  const maxW = Math.max(...nodes.map(n => nodeW(n)))
  const maxH = Math.max(...nodes.map(n => nodeH(n)))
  return Object.fromEntries(
    sorted.map((n, i) => [
      n.id,
      { x: startX + (i % cols) * (maxW + GAP), y: startY + Math.floor(i / cols) * (maxH + GAP) },
    ]),
  )
}
