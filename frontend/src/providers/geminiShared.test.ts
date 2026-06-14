import { describe, it, expect } from 'vitest'
import { parseGenerateContentResponse, computeGeminiCost } from './geminiShared'

describe('computeGeminiCost', () => {
  it('uses fixed per-image price for image models (default tier when size unknown)', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290)).toBeCloseTo(0.067)
  })
  it('applies multiplier (batch discount)', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 0.5)).toBeCloseTo(0.0335)
  })
  it('is resolution-aware for Flash image tiers', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 1, '0.5K')).toBeCloseTo(0.045)
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 1, '1K')).toBeCloseTo(0.067)
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 1, '2K')).toBeCloseTo(0.101)
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 1, '4K')).toBeCloseTo(0.151)
  })
  it('is resolution-aware for Pro image tiers', () => {
    expect(computeGeminiCost('gemini-3-pro-image-preview', 100, 1290, 1, '1K')).toBeCloseTo(0.134)
    expect(computeGeminiCost('gemini-3-pro-image-preview', 100, 1290, 1, '2K')).toBeCloseTo(0.134)
    expect(computeGeminiCost('gemini-3-pro-image-preview', 100, 1290, 1, '4K')).toBeCloseTo(0.240)
  })
  it('4K tier with batch discount compounds correctly', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 0.5, '4K')).toBeCloseTo(0.0755)
  })
  it('falls back to default tier for an unknown imageSize string', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 1, 'bogus')).toBeCloseTo(0.067)
  })
  it('ignores imageSize for non-image models (per-token pricing)', () => {
    // gemini-3.1-pro-preview: [2.00, 12.00] per 1M → 1M in + 1M out = 14
    expect(computeGeminiCost('gemini-3.1-pro-preview', 1_000_000, 1_000_000, 1, '4K')).toBeCloseTo(14)
  })
})

describe('parseGenerateContentResponse', () => {
  const resp = {
    candidates: [{ content: { parts: [{ inlineData: { data: 'AAAA' } }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290 },
  }
  it('extracts image and usage', () => {
    const r = parseGenerateContentResponse(resp, 'gemini-3.1-flash-image-preview', 1)
    expect(r.image_b64).toBe('AAAA')
    expect(r.status).toBe('OK')
    expect(r.usage?.cost_usd).toBeCloseTo(0.067)
  })
  it('handles snake_case REST fields', () => {
    const snake = {
      candidates: [{ content: { parts: [{ inline_data: { data: 'BBBB' } }] } }],
      usage_metadata: { prompt_token_count: 5, candidates_token_count: 100 },
    }
    const r = parseGenerateContentResponse(snake, 'gemini-3.1-flash-image-preview', 0.5)
    expect(r.image_b64).toBe('BBBB')
    expect(r.usage?.cost_usd).toBeCloseTo(0.0335)
  })
  it('threads imageSize into the logged cost (4K)', () => {
    const r = parseGenerateContentResponse(resp, 'gemini-3.1-flash-image-preview', 1, '4K')
    expect(r.usage?.cost_usd).toBeCloseTo(0.151)
  })
  it('returns status when no image part', () => {
    const r = parseGenerateContentResponse({ candidates: [{ content: { parts: [{ text: 'nope' }] } }] }, 'x', 1)
    expect(r.image_b64).toBeNull()
    expect(r.status).toBe('No image generated')
  })
  it('returns status on empty/malformed response', () => {
    const r = parseGenerateContentResponse({}, 'x', 1)
    expect(r.image_b64).toBeNull()
    expect(r.status).toBe('No image generated')
    expect(r.usage).toBeUndefined()
  })
})
