import { describe, expect, it } from 'vitest'
import { computeCropRect } from './cropToAspectRatio'

describe('computeCropRect', () => {
  it('returns null when aspect ratio is empty string', () => {
    expect(computeCropRect(1000, 1000, '')).toBeNull()
  })

  it('returns null when aspect ratio is malformed', () => {
    expect(computeCropRect(1000, 1000, 'abc')).toBeNull()
    expect(computeCropRect(1000, 1000, '16-9')).toBeNull()
    expect(computeCropRect(1000, 1000, '16:')).toBeNull()
    expect(computeCropRect(1000, 1000, ':9')).toBeNull()
  })

  it('returns null when aspect ratio has a zero component', () => {
    expect(computeCropRect(1000, 1000, '0:1')).toBeNull()
    expect(computeCropRect(1000, 1000, '1:0')).toBeNull()
  })

  it('returns null when source dimensions are invalid', () => {
    expect(computeCropRect(0, 1000, '16:9')).toBeNull()
    expect(computeCropRect(1000, 0, '16:9')).toBeNull()
    expect(computeCropRect(-1, 1000, '16:9')).toBeNull()
  })

  it('returns null when source already matches the target ratio exactly', () => {
    expect(computeCropRect(1600, 900, '16:9')).toBeNull()
    expect(computeCropRect(900, 1600, '9:16')).toBeNull()
    expect(computeCropRect(1000, 1000, '1:1')).toBeNull()
  })

  it('crops sides when source is wider than target (landscape → 16:9)', () => {
    // 2000×1000 (2.0) → 16:9 (1.778) — keep height, reduce width
    const rect = computeCropRect(2000, 1000, '16:9')
    expect(rect).not.toBeNull()
    expect(rect!.h).toBe(1000)
    expect(rect!.w).toBe(1778)
    expect(rect!.x).toBe(111)
    expect(rect!.y).toBe(0)
  })

  it('crops top/bottom when source is taller than target (portrait → 9:16)', () => {
    // 1000×2000 (0.5) → 9:16 (0.5625) — keep width, reduce height
    const rect = computeCropRect(1000, 2000, '9:16')
    expect(rect).not.toBeNull()
    expect(rect!.w).toBe(1000)
    expect(rect!.h).toBe(1778)
    expect(rect!.x).toBe(0)
    expect(rect!.y).toBe(111)
  })

  it('crops top/bottom when square is cropped to 16:9', () => {
    // 1000×1000 (1.0) → 16:9 (1.778) — keep width, reduce height
    const rect = computeCropRect(1000, 1000, '16:9')
    expect(rect).not.toBeNull()
    expect(rect!.w).toBe(1000)
    expect(rect!.h).toBe(563)
    expect(rect!.x).toBe(0)
    expect(rect!.y).toBe(219)
  })

  it('crops sides when square is cropped to 9:16', () => {
    // 1000×1000 (1.0) → 9:16 (0.5625) — keep height, reduce width
    const rect = computeCropRect(1000, 1000, '9:16')
    expect(rect).not.toBeNull()
    expect(rect!.w).toBe(563)
    expect(rect!.h).toBe(1000)
    expect(rect!.x).toBe(219)
    expect(rect!.y).toBe(0)
  })

  it('handles asymmetric extreme ratios (8:1 cinematic banner)', () => {
    // 2000×1000 (2.0) → 8:1 (8.0) — keep width, reduce height
    const rect = computeCropRect(2000, 1000, '8:1')
    expect(rect).not.toBeNull()
    expect(rect!.w).toBe(2000)
    expect(rect!.h).toBe(250)
    expect(rect!.x).toBe(0)
    expect(rect!.y).toBe(375)
  })

  it('centers the crop rect within the source', () => {
    const rect = computeCropRect(1920, 1080, '1:1')!
    expect(rect.w).toBe(1080)
    expect(rect.h).toBe(1080)
    expect(rect.x).toBe(420)
    expect(rect.y).toBe(0)
  })

  it('treats source matching within 0.001 ratio as exact match', () => {
    // 1601×900 ratio = 1.7789, 16:9 = 1.7777, delta ≈ 0.0012 — outside tolerance
    expect(computeCropRect(1601, 900, '16:9')).not.toBeNull()
    // 16001×9000 ratio = 1.77789, 16:9 = 1.77777, delta ≈ 0.00012 — within tolerance
    expect(computeCropRect(16001, 9000, '16:9')).toBeNull()
  })
})
