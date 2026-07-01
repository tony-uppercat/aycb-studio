import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildBatchLine,
  runOpenAIBatch,
  submitOpenAIBatch,
  pollOpenAIBatch,
  fetchOpenAIBatchResults,
} from './openaiBatchPath'
import { computeCost } from './openaiProvider'

// Mock computeCost so the cost-discount test is deterministic. Default to the
// real token formula so the runOpenAIBatch suite keeps its exact assertions.
vi.mock('./openaiProvider', () => ({
  computeCost: vi.fn((usage: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } }) => {
    const details = usage.input_tokens_details ?? {}
    const textIn = details.text_tokens ?? usage.input_tokens ?? 0
    const imgIn = details.image_tokens ?? 0
    const imgOut = usage.output_tokens ?? 0
    return (textIn / 1_000_000) * 5 + (imgIn / 1_000_000) * 8 + (imgOut / 1_000_000) * 30
  }),
}))

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) }
}

describe('buildBatchLine', () => {
  it('wraps body with custom_id/method/url', () => {
    const line = JSON.parse(buildBatchLine('/v1/images/generations', { model: 'gpt-image-2', prompt: 'p' }))
    expect(line).toEqual({
      custom_id: 'r0', method: 'POST', url: '/v1/images/generations',
      body: { model: 'gpt-image-2', prompt: 'p' },
    })
  })
})

describe('runOpenAIBatch', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  const RESULT_LINE = JSON.stringify({
    custom_id: 'r0',
    response: { body: { data: [{ b64_json: 'IMG64' }], usage: { input_tokens: 100, output_tokens: 1000, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } } },
  })

  it('text-to-image: uploads JSONL, creates batch on /generations, polls, decodes at half cost', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))                            // JSONL upload
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'validating' }))      // batches.create
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'in_progress' }))     // poll
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'completed', output_file_id: 'file-out' }))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(RESULT_LINE) }) // download
      .mockResolvedValue(okJson({}))                                               // cleanup deletes
    vi.stubGlobal('fetch', fetchMock)

    const r = await runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'K', size: '1024x1024', quality: 'medium' }, { pollMs: 0 })
    expect(r.image_b64).toBe('IMG64')
    expect(r.status).toBe('OK')
    // sync cost: 100/1M*5 + 1000/1M*30 = 0.0305 → batch half = 0.01525
    expect(r.usage?.cost_usd).toBeCloseTo(0.01525)

    const createCall = fetchMock.mock.calls[1]
    expect(createCall[0]).toContain('/v1/batches')
    const created = JSON.parse(createCall[1].body)
    expect(created.endpoint).toBe('/v1/images/generations')
    expect(created.completion_window).toBe('24h')
    expect(created.input_file_id).toBe('file-in')
  })

  it('with refs: uploads vision files first and targets /edits with file_id objects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-ref0' }))                          // vision upload
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))                            // JSONL upload
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'validating' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'completed', output_file_id: 'file-out' }))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(RESULT_LINE) })
      .mockResolvedValue(okJson({}))
    vi.stubGlobal('fetch', fetchMock)

    const ref = new File(['x'], 'ref.png', { type: 'image/png' })
    const r = await runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'K', size: 'auto', quality: 'high', refs: [ref] }, { pollMs: 0 })
    expect(r.image_b64).toBe('IMG64')

    const visionForm = fetchMock.mock.calls[0][1].body as FormData
    expect(visionForm.get('purpose')).toBe('vision')
    const created = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(created.endpoint).toBe('/v1/images/edits')
    // JSONL body must reference the uploaded vision file
    const jsonlBlob = (fetchMock.mock.calls[1][1].body as FormData).get('file') as Blob
    const jsonlText = await jsonlBlob.text()
    expect(JSON.parse(jsonlText.trim()).body.images).toEqual([{ file_id: 'file-ref0' }])
  })

  it('surfaces batch failure with error detail', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'validating' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'failed', errors: { data: [{ message: 'endpoint not supported' }] } }))
      .mockResolvedValue(okJson({})))
    const r = await runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'K', size: 'auto', quality: 'high' }, { pollMs: 0 })
    expect(r.image_b64).toBeNull()
    expect(r.status).toContain('endpoint not supported')
  })

  it('surfaces per-request error line', async () => {
    const errLine = JSON.stringify({ custom_id: 'r0', error: { message: 'content policy' } })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'validating' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'completed', output_file_id: 'file-out' }))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(errLine) })
      .mockResolvedValue(okJson({})))
    const r = await runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'K', size: 'auto', quality: 'high' }, { pollMs: 0 })
    expect(r.image_b64).toBeNull()
    expect(r.status).toContain('content policy')
  })

  it('throws a clear error when the JSONL upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve('{"error":{"message":"invalid key"}}') }))
    await expect(runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'BAD', size: 'auto', quality: 'high' }, { pollMs: 0 }))
      .rejects.toThrow(/invalid key/)
  })
})

describe('fetchOpenAIBatchResults', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('parses a 2-line output into a Map keyed by custom_id at half cost', async () => {
    // Force computeCost to a known value so the ×0.5 discount is exact.
    vi.mocked(computeCost).mockReturnValue(0.10)
    const lineA = JSON.stringify({ custom_id: 'nA', response: { body: { data: [{ b64_json: 'AAA' }], usage: { input_tokens: 1, output_tokens: 2 } } } })
    const lineB = JSON.stringify({ custom_id: 'nB', response: { body: { data: [{ b64_json: 'BBB' }], usage: { input_tokens: 3, output_tokens: 4 } } } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(`${lineA}\n${lineB}\n`) }))

    const map = await fetchOpenAIBatchResults('file-out', 'K')
    expect(map.size).toBe(2)
    expect(map.get('nA')?.image_b64).toBe('AAA')
    expect(map.get('nA')?.status).toBe('OK')
    expect(map.get('nA')?.usage?.cost_usd).toBeCloseTo(0.05)
    expect(map.get('nB')?.image_b64).toBe('BBB')
    expect(map.get('nB')?.usage?.cost_usd).toBeCloseTo(0.05)
  })

  it('records per-request error lines without an image', async () => {
    const errLine = JSON.stringify({ custom_id: 'nE', error: { message: 'content policy' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(`${errLine}\n`) }))
    const map = await fetchOpenAIBatchResults('file-out', 'K')
    expect(map.get('nE')?.image_b64).toBeNull()
    expect(map.get('nE')?.status).toContain('content policy')
  })
})

describe('pollOpenAIBatch', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns done=true + outputFileId when completed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ id: 'b1', status: 'completed', output_file_id: 'file-out' })))
    const tick = await pollOpenAIBatch('b1', 'K')
    expect(tick.done).toBe(true)
    expect(tick.status).toBe('completed')
    expect(tick.outputFileId).toBe('file-out')
  })

  it('returns done=false while in_progress', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okJson({ id: 'b1', status: 'in_progress' })))
    const tick = await pollOpenAIBatch('b1', 'K')
    expect(tick.done).toBe(false)
    expect(tick.status).toBe('in_progress')
    expect(tick.outputFileId).toBeNull()
  })
})

describe('submitOpenAIBatch', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('cleans up already-uploaded vision files when a later upload fails mid-submit (M4)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-ref0' }))                                         // vision ref upload OK
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('{"error":{"message":"boom"}}') }) // JSONL upload FAILS
      .mockResolvedValue(okJson({}))                                                              // cleanup DELETE
    vi.stubGlobal('fetch', fetchMock)

    const ref = new File(['x'], 'ref.png', { type: 'image/png' })
    await expect(submitOpenAIBatch(
      [{ customId: 'r0', body: { model: 'gpt-image-2', prompt: 'p', n: 1, size: 'auto', quality: 'high' }, refs: [ref] }],
      'K',
    )).rejects.toThrow(/boom/)

    // the orphaned vision file must have been DELETEd
    const deleteCalls = fetchMock.mock.calls.filter(c => c[1]?.method === 'DELETE')
    expect(deleteCalls.some(c => String(c[0]).includes('file-ref0'))).toBe(true)
  })

  it('no-refs: uploads JSONL then creates batch and preserves the real custom_id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))                        // JSONL upload
      .mockResolvedValueOnce(okJson({ id: 'batch-9', status: 'validating' }))  // batches.create
    vi.stubGlobal('fetch', fetchMock)

    const out = await submitOpenAIBatch(
      [{ customId: 'myId', body: { model: 'gpt-image-2', prompt: 'p', n: 1, size: 'auto', quality: 'high' } }],
      'K',
    )
    expect(out.batchId).toBe('batch-9')
    expect(out.inputFileId).toBe('file-in')
    expect(out.endpoint).toBe('/v1/images/generations')
    expect(out.refFileIds).toEqual([])

    // First call hits /v1/files (multipart batch upload); the JSONL line keeps myId.
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/files')
    const jsonlBlob = (fetchMock.mock.calls[0][1].body as FormData).get('file') as Blob
    const parsed = JSON.parse((await jsonlBlob.text()).trim())
    expect(parsed.custom_id).toBe('myId')
    expect(parsed.url).toBe('/v1/images/generations')

    // Second call hits /v1/batches.
    expect(fetchMock.mock.calls[1][0]).toContain('/v1/batches')
    const created = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(created.input_file_id).toBe('file-in')
    expect(created.endpoint).toBe('/v1/images/generations')
    expect(created.completion_window).toBe('24h')
  })
})
