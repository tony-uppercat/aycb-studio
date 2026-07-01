import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runGeminiBatch, extractInlineEntry, extractAllInlineEntries, geminiSupportsBatch } from './geminiBatchPath'

const SUBMIT_OK = { name: 'batches/abc123', metadata: { state: 'BATCH_STATE_PENDING' } }
const REQUEST_BODY = { contents: [{ role: 'user', parts: [{ text: 'p' }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) }
}

describe('geminiSupportsBatch', () => {
  it('accepts pro/flash/flash-lite image models (GA ids)', () => {
    expect(geminiSupportsBatch('gemini-3-pro-image')).toBe(true)
    expect(geminiSupportsBatch('gemini-3.1-flash-image')).toBe(true)
    expect(geminiSupportsBatch('gemini-3.1-flash-lite-image')).toBe(true)
  })
  it('rejects non-image / unknown ids', () => {
    expect(geminiSupportsBatch('gemini-3.1-pro-preview')).toBe(false)
  })
})

describe('runGeminiBatch', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('submits one inline request and polls to success at half cost', async () => {
    // Shape captured live via scripts/smoke_test_gemini_batch_inline.py
    const done = {
      name: 'batches/abc123', done: true,
      metadata: { state: 'BATCH_STATE_SUCCEEDED' },
      response: { inlinedResponses: { inlinedResponses: [{ response: {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'IMG64' } }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 1505 },
      }, metadata: { key: 'r0' } }] } },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson(SUBMIT_OK))
      .mockResolvedValueOnce(okJson({ ...SUBMIT_OK, metadata: { state: 'BATCH_STATE_RUNNING' } }))
      .mockResolvedValueOnce(okJson(done))
    vi.stubGlobal('fetch', fetchMock)

    const r = await runGeminiBatch('gemini-3.1-flash-image', REQUEST_BODY, 'KEY', { pollMs: 0 })
    expect(r.image_b64).toBe('IMG64')
    expect(r.status).toBe('OK')
    expect(r.usage?.cost_usd).toBeCloseTo(0.0335)   // 0.067 × 0.5

    const submitCall = fetchMock.mock.calls[0]
    expect(submitCall[0]).toContain(':batchGenerateContent')
    const sent = JSON.parse(submitCall[1].body)
    expect(sent.batch.input_config.requests.requests[0].request).toEqual(REQUEST_BODY)
    expect(fetchMock.mock.calls[1][0]).toContain('/v1beta/batches/abc123')
  })

  it('surfaces a per-request error entry', async () => {
    const failed = {
      done: true, metadata: { state: 'BATCH_STATE_SUCCEEDED' },
      response: { inlinedResponses: { inlinedResponses: [{ error: { message: 'quota exceeded' } }] } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson(SUBMIT_OK))
      .mockResolvedValueOnce(okJson(failed)))
    const r = await runGeminiBatch('m', REQUEST_BODY, 'KEY', { pollMs: 0 })
    expect(r.image_b64).toBeNull()
    expect(r.status).toContain('quota exceeded')
  })

  it('surfaces a failed job state', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson(SUBMIT_OK))
      .mockResolvedValueOnce(okJson({ done: true, metadata: { state: 'BATCH_STATE_FAILED' }, error: { message: 'boom' } })))
    const r = await runGeminiBatch('m', REQUEST_BODY, 'KEY', { pollMs: 0 })
    expect(r.image_b64).toBeNull()
    expect(r.status).toContain('boom')
  })

  it('throws a clear error on submit HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('{"error":{"message":"bad"}}') }))
    await expect(runGeminiBatch('m', REQUEST_BODY, 'KEY', { pollMs: 0 })).rejects.toThrow(/bad/)
  })

  it('throws on poll HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson(SUBMIT_OK))
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('oops') }))
    await expect(runGeminiBatch('m', REQUEST_BODY, 'KEY', { pollMs: 0 })).rejects.toThrow(/poll failed/)
  })
})

describe('extractInlineEntry', () => {
  it('handles the verified nesting (inlinedResponses.inlinedResponses)', () => {
    const op = { response: { inlinedResponses: { inlinedResponses: [{ response: { candidates: [] } }] } } }
    expect(extractInlineEntry(op)).toEqual({ response: { candidates: [] } })
  })
  it('tolerates a flat inlinedResponses array (alternate nesting)', () => {
    const op = { response: { inlinedResponses: [{ response: { candidates: [] } }] } }
    expect(extractInlineEntry(op)).toEqual({ response: { candidates: [] } })
  })
  it('returns null when missing', () => {
    expect(extractInlineEntry({ response: {} })).toBeNull()
    expect(extractInlineEntry({})).toBeNull()
  })
})

describe('extractAllInlineEntries', () => {
  it('maps every inlined entry by metadata key', () => {
    const op = {
      response: { inlinedResponses: { inlinedResponses: [
        { metadata: { key: 'nodeA' }, response: { candidates: [{ content: { parts: [{ text: 'A' }] } }] } },
        { metadata: { key: 'nodeB' }, response: { candidates: [{ content: { parts: [{ text: 'B' }] } }] } },
      ] } },
    }
    const map = extractAllInlineEntries(op)
    expect([...map.keys()].sort()).toEqual(['nodeA', 'nodeB'])
    expect(map.get('nodeA')).toBeDefined()
    expect(map.get('nodeA').response.candidates[0].content.parts[0].text).toBe('A')
  })

  it('falls back to index keys when metadata is missing', () => {
    const op = { response: { inlinedResponses: { inlinedResponses: [{ response: {} }] } } }
    const map = extractAllInlineEntries(op)
    expect(map.has('0')).toBe(true)
  })
})
