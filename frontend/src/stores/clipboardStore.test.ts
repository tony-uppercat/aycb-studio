import { describe, it, expect, beforeEach } from 'vitest'
import { canvasClipboard } from './clipboardStore'

describe('canvasClipboard (shared module-level singleton)', () => {
  beforeEach(() => {
    canvasClipboard.current = null
  })

  it('persists writes across sequential reads', () => {
    canvasClipboard.current = {
      nodes: [{ id: 'a', type: 'text', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }
    expect(canvasClipboard.current?.nodes[0].id).toBe('a')
  })

  it('shares the same reference across re-imports', async () => {
    canvasClipboard.current = {
      nodes: [{ id: 'shared', type: 'text', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }
    const reimport = await import('./clipboardStore')
    expect(reimport.canvasClipboard).toBe(canvasClipboard)
    expect(reimport.canvasClipboard.current?.nodes[0].id).toBe('shared')
  })
})
