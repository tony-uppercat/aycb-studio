import { test, expect, vi, beforeEach } from 'vitest'
import { chunkBySize, MAX_BUNDLE_BYTES, enqueueAsyncRequest, flushModel } from './asyncBundler'

const addJobSpy = vi.fn()
const setPendingCountSpy = vi.fn()
vi.mock('../providers/geminiBatchPath', () => ({ submitGeminiBatch: vi.fn().mockResolvedValue('operations/x') }))
vi.mock('../providers/openaiBatchPath', () => ({ submitOpenAIBatch: vi.fn().mockResolvedValue({ batchId: 'batch_x', inputFileId: 'f_in', refFileIds: [], endpoint: '/v1/images/generations' }) }))
vi.mock('../stores/asyncJobStore', () => ({ useAsyncJobStore: { getState: () => ({ addJob: addJobSpy, setPendingCount: setPendingCountSpy }) } }))
const addLogSpy = vi.fn()
vi.mock('../stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ activeProjectId: 'p1', addLog: addLogSpy }) } }))

import { submitGeminiBatch } from '../providers/geminiBatchPath'
import { submitOpenAIBatch } from '../providers/openaiBatchPath'

beforeEach(() => {
  addJobSpy.mockClear()
  setPendingCountSpy.mockClear()
  addLogSpy.mockClear()
  vi.mocked(submitGeminiBatch).mockReset().mockResolvedValue('operations/x')
  vi.mocked(submitOpenAIBatch).mockReset().mockResolvedValue({ batchId: 'batch_x', inputFileId: 'f_in', refFileIds: [], endpoint: '/v1/images/generations' })
})

test('enqueueAsyncRequest de-dupes by nodeId — re-run replaces the pending request', async () => {
  const base = { nodeId: 'nodeA', key: 'nodeA', body: { v: 1 }, bytes: 1, modelId: 'gemini-3.1-flash-image-preview', provider: 'gemini' as const, bundleKey: 'gemini-3.1-flash-image-preview', apiKey: 'KEY123' }
  enqueueAsyncRequest(base)
  enqueueAsyncRequest({ ...base, body: { v: 2 } })   // same nodeId, newer body
  await flushModel('gemini-3.1-flash-image-preview')
  // Only one request submitted, and it's the latest body
  expect(submitGeminiBatch).toHaveBeenCalledTimes(1)
  const reqs = (submitGeminiBatch as any).mock.calls[0][1]
  expect(reqs).toHaveLength(1)
  expect(reqs[0].body).toEqual({ v: 2 })
  // The live key carried on the request reaches submit as the 3rd arg
  expect(submitGeminiBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'KEY123')
  // A [batch] submit log surfaces to the Console after a successful flush
  expect(addLogSpy).toHaveBeenCalledWith(expect.stringContaining('[batch] submit'))
})

test('enqueueAsyncRequest syncs pendingCount as requests accumulate in a bucket', async () => {
  const base = { key: '', body: {}, bytes: 1, modelId: 'gemini-3.1-flash-image-preview', provider: 'gemini' as const, bundleKey: 'pending-sync-key', apiKey: 'k' }
  enqueueAsyncRequest({ ...base, nodeId: 'n1', key: 'n1' })
  enqueueAsyncRequest({ ...base, nodeId: 'n2', key: 'n2' })
  expect(setPendingCountSpy).toHaveBeenLastCalledWith(2)
  await flushModel('pending-sync-key')   // drain the bucket so it doesn't leak into later tests
})

test('chunkBySize splits when estimated bytes exceed the cap', () => {
  const items = [
    { key: 'a', bytes: MAX_BUNDLE_BYTES * 0.6 },
    { key: 'b', bytes: MAX_BUNDLE_BYTES * 0.6 },
    { key: 'c', bytes: 10 },
  ]
  const chunks = chunkBySize(items)
  expect(chunks.length).toBe(2)
  expect(chunks[0].map(i => i.key)).toEqual(['a'])
  expect(chunks[1].map(i => i.key)).toEqual(['b', 'c'])
})

test('chunkBySize keeps everything in one chunk when under cap', () => {
  const items = [{ key: 'a', bytes: 1 }, { key: 'b', bytes: 1 }]
  expect(chunkBySize(items).length).toBe(1)
})

test('chunkBySize puts an oversize single item in its own chunk', () => {
  const items = [{ key: 'a', bytes: MAX_BUNDLE_BYTES * 2 }, { key: 'b', bytes: 5 }]
  const chunks = chunkBySize(items)
  expect(chunks[0].map(i => i.key)).toEqual(['a'])
  expect(chunks[1].map(i => i.key)).toEqual(['b'])
})

test('flushModel records a failed job when submit throws', async () => {
  addJobSpy.mockClear()
  ;(submitGeminiBatch as any).mockRejectedValueOnce(new Error('429 rate limit'))
  enqueueAsyncRequest({ nodeId: 'nX', key: 'nX', body: {}, bytes: 1, modelId: 'gemini-3.1-flash-image-preview', provider: 'gemini', bundleKey: 'gemini-3.1-flash-image-preview', apiKey: 'k' })
  await flushModel('gemini-3.1-flash-image-preview')
  expect(addJobSpy).toHaveBeenCalledWith(expect.objectContaining({
    status: 'failed',
    requests: [expect.objectContaining({ nodeId: 'nX', error: '429 rate limit' })],
  }))
})

test('an OpenAI request flushes via submitOpenAIBatch and records an openai job', async () => {
  enqueueAsyncRequest({ nodeId: 'oA', key: 'oA', body: { prompt: 'cat' }, bytes: 1, modelId: 'gpt-image-2', provider: 'openai', bundleKey: 'gpt-image-2|gen', apiKey: 'k' })
  await flushModel('gpt-image-2|gen')
  expect(submitOpenAIBatch).toHaveBeenCalledTimes(1)
  expect(submitGeminiBatch).not.toHaveBeenCalled()
  expect(addJobSpy).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'openai',
    openai: expect.objectContaining({ batchId: 'batch_x' }),
  }))
})
