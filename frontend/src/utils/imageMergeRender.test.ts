import { describe, it, expect } from 'vitest'
import { defaultGridColumns } from './imageMergeRender'

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
