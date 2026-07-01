import { describe, it, expect } from 'vitest'
import { defaultGridColumns, computeMergeLayout, MAX_CANVAS_DIM, MAX_CANVAS_AREA } from './imageMergeRender'

const AUTO = (layout: 'grid' | 'horizontal' | 'vertical', columns = 2, gap = 0) =>
  ({ layout, columns, gap, outputMode: 'auto', customW: 0, customH: 0 })

describe('defaultGridColumns', () => {
  it('returns 1 for empty or single-image grids', () => {
    expect(defaultGridColumns(0)).toBe(1)
    expect(defaultGridColumns(1)).toBe(1)
  })

  it('produces roughly square layouts', () => {
    // 2 images → 2 cols (1 row of 2)
    expect(defaultGridColumns(2)).toBe(2)
    // 4 images → 2 cols (2x2)
    expect(defaultGridColumns(4)).toBe(2)
    // 5 images → 3 cols (3 + 2)
    expect(defaultGridColumns(5)).toBe(3)
    // 9 images → 3 cols (3x3)
    expect(defaultGridColumns(9)).toBe(3)
    // 10 images → 4 cols
    expect(defaultGridColumns(10)).toBe(4)
    // 16 images → 4 cols (4x4)
    expect(defaultGridColumns(16)).toBe(4)
  })
})

describe('computeMergeLayout — resolution', () => {
  it('auto mode sizes cells to the largest input (no downscale)', () => {
    const layout = computeMergeLayout(
      [{ w: 2000, h: 1000 }, { w: 1000, h: 2000 }],
      AUTO('horizontal'),
    )
    // cell = max width × max height across inputs
    expect(layout.cellW).toBe(2000)
    expect(layout.cellH).toBe(2000)
    expect(layout.canvasW).toBe(4000)
    expect(layout.canvasH).toBe(2000)
  })

  it('keeps the largest input at native res where the old 8192 cap downscaled it', () => {
    // Three 4000px-wide images side by side → 12000px canvas.
    // Old behaviour clamped to 8192 → cells ~2730px (largest input downscaled).
    const layout = computeMergeLayout(
      [{ w: 4000, h: 4000 }, { w: 4000, h: 4000 }, { w: 4000, h: 4000 }],
      AUTO('horizontal'),
    )
    expect(layout.canvasW).toBe(12000)
    expect(layout.cellW).toBe(4000) // full native resolution preserved
  })

  it('two 8K images merge at full resolution (per-side cap = 16384)', () => {
    const layout = computeMergeLayout(
      [{ w: 8192, h: 8192 }, { w: 8192, h: 8192 }],
      AUTO('horizontal'),
    )
    expect(layout.canvasW).toBe(16384)
    expect(layout.cellW).toBe(8192)
  })

  it('caps a single oversized dimension and preserves aspect ratio', () => {
    // 5 × 4096-wide → 20480px, over the 16384 per-side cap.
    const layout = computeMergeLayout(
      Array.from({ length: 5 }, () => ({ w: 4096, h: 2000 })),
      AUTO('horizontal'),
    )
    expect(layout.canvasW).toBe(MAX_CANVAS_DIM)
    // aspect preserved: original 20480×2000 scaled by 16384/20480 = 0.8 → 1600
    expect(layout.canvasH).toBe(1600)
  })

  it('caps total area for huge grids (memory safety)', () => {
    // 4×4 grid of 4096² → 16384×16384 = 268M px, over the area cap.
    const layout = computeMergeLayout(
      Array.from({ length: 16 }, () => ({ w: 4096, h: 4096 })),
      AUTO('grid', 4),
    )
    expect(layout.canvasW * layout.canvasH).toBeLessThanOrEqual(MAX_CANVAS_AREA + 2)
    expect(layout.canvasW).toBeLessThan(MAX_CANVAS_DIM)
  })

  it('first mode uses the first image dimensions', () => {
    const layout = computeMergeLayout(
      [{ w: 1024, h: 768 }, { w: 4000, h: 4000 }],
      { layout: 'horizontal', columns: 2, gap: 0, outputMode: 'first', customW: 0, customH: 0 },
    )
    expect(layout.cellW).toBe(1024)
    expect(layout.cellH).toBe(768)
  })

  it('custom mode honours explicit canvas dimensions', () => {
    const layout = computeMergeLayout(
      [{ w: 4000, h: 4000 }, { w: 4000, h: 4000 }],
      { layout: 'horizontal', columns: 2, gap: 0, outputMode: 'custom', customW: 2048, customH: 1024 },
    )
    expect(layout.canvasW).toBe(2048)
    expect(layout.canvasH).toBe(1024)
  })
})
