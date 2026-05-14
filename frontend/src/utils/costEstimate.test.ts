import { describe, expect, it } from 'vitest'
import { estimateCost } from './costEstimate'

describe('estimateCost — Gemini image quality push additions', () => {
  it('returns 0.045 for Flash 0.5K', () => {
    const result = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'short', 0, 0, 1, '0.5K')
    expect(result.costUsd).toBeCloseTo(0.045, 3)
  })

  it('preserves existing 1K Flash cost (0.067) when thinking=false', () => {
    const result = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'short', 0, 0, 1, '1K', false)
    expect(result.costUsd).toBeCloseTo(0.067, 3)
  })

  it('applies thinking ×1.3 multiplier on Pro 4K', () => {
    const base = estimateCost('gemini-3-pro-image-preview', 'generate_image', 'short', 0, 0, 1, '4K', false)
    const withThinking = estimateCost('gemini-3-pro-image-preview', 'generate_image', 'short', 0, 0, 1, '4K', true)
    expect(base.costUsd).toBeCloseTo(0.240, 3)
    expect(withThinking.costUsd).toBeCloseTo(0.240 * 1.3, 3)
  })

  it('applies thinking ×1.3 on Flash 0.5K too', () => {
    const withThinking = estimateCost('gemini-3.1-flash-image-preview', 'generate_image', 'short', 0, 0, 1, '0.5K', true)
    expect(withThinking.costUsd).toBeCloseTo(0.045 * 1.3, 3)
  })
})
