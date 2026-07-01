import { describe, it, expect } from 'vitest'
import { flipParams } from './flipImage'

describe('flipParams', () => {
  it('horizontal mirrors across the vertical axis (translate to right edge, negate x)', () => {
    expect(flipParams('horizontal', 800, 600)).toEqual({ tx: 800, ty: 0, sx: -1, sy: 1 })
  })

  it('vertical mirrors across the horizontal axis (translate to bottom edge, negate y)', () => {
    expect(flipParams('vertical', 800, 600)).toEqual({ tx: 0, ty: 600, sx: 1, sy: -1 })
  })

  it('keeps the non-flipped axis untouched (scale 1, no translate)', () => {
    const h = flipParams('horizontal', 1024, 512)
    expect(h.sy).toBe(1)
    expect(h.ty).toBe(0)
    const v = flipParams('vertical', 1024, 512)
    expect(v.sx).toBe(1)
    expect(v.tx).toBe(0)
  })
})
