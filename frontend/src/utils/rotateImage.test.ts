import { describe, it, expect } from 'vitest'
import { rotateParams } from './rotateImage'

describe('rotateParams', () => {
  it('90 CW swaps dimensions and translates to the new right edge', () => {
    expect(rotateParams(90, 800, 600)).toEqual({
      width: 600, height: 800, tx: 600, ty: 0, rad: Math.PI / 2,
    })
  })

  it('180 keeps dimensions and translates to the far corner', () => {
    expect(rotateParams(180, 800, 600)).toEqual({
      width: 800, height: 600, tx: 800, ty: 600, rad: Math.PI,
    })
  })

  it('270 CW (90 CCW) swaps dimensions and translates to the new bottom edge', () => {
    expect(rotateParams(270, 800, 600)).toEqual({
      width: 600, height: 800, tx: 0, ty: 800, rad: -Math.PI / 2,
    })
  })

  it('quarter turns map source corners in-bounds', () => {
    // 90 CW: source top-left (0,0) lands at output top-right (h, 0)
    const p90 = rotateParams(90, 800, 600)
    const rot = (rad: number, x: number, y: number, tx: number, ty: number) => ({
      x: tx + x * Math.cos(rad) - y * Math.sin(rad),
      y: ty + x * Math.sin(rad) + y * Math.cos(rad),
    })
    const tl90 = rot(p90.rad, 0, 0, p90.tx, p90.ty)
    expect(tl90.x).toBeCloseTo(600)
    expect(tl90.y).toBeCloseTo(0)
    // 270 CW: source top-right (800,0) lands at output top-left (0, 0)
    const p270 = rotateParams(270, 800, 600)
    const tr270 = rot(p270.rad, 800, 0, p270.tx, p270.ty)
    expect(tr270.x).toBeCloseTo(0)
    expect(tr270.y).toBeCloseTo(0)
  })
})
