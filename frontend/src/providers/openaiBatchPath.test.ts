import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildBatchLine, runOpenAIBatch } from './openaiBatchPath'

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
