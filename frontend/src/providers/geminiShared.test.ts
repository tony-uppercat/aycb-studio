import { describe, it, expect } from 'vitest'
import { parseGenerateContentResponse, computeGeminiCost } from './geminiShared'

describe('computeGeminiCost', () => {
  it('uses fixed per-image price for image models', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290)).toBeCloseTo(0.067)
  })
  it('applies multiplier (batch discount)', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 0.5)).toBeCloseTo(0.0335)
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
