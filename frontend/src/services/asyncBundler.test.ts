import { test, expect, vi } from 'vitest'
import { chunkBySize, MAX_BUNDLE_BYTES, enqueueAsyncRequest, flushModel } from './asyncBundler'

vi.mock('../providers/geminiBatchPath', () => ({ submitGeminiBatch: vi.fn().mockResolvedValue('operations/x') }))
vi.mock('../stores/asyncJobStore', () => ({ useAsyncJobStore: { getState: () => ({ addJob: vi.fn() }) } }))
vi.mock('../stores/canvasStore', () => ({ useCanvasStore: { getState: () => ({ activeProjectId: 'p1' }) } }))

import { submitGeminiBatch } from '../providers/geminiBatchPath'

test('enqueueAsyncRequest de-dupes by nodeId — re-run replaces the pending request', async () => {
  const base = { nodeId: 'nodeA', key: 'nodeA', body: { v: 1 }, bytes: 1, modelId: 'gemini-3.1-flash-image-preview' }
  enqueueAsyncRequest(base)
  enqueueAsyncRequest({ ...base, body: { v: 2 } })   // same nodeId, newer body
  await flushModel('gemini-3.1-flash-image-preview')
  // Only one request submitted, and it's the latest body
  expect(submitGeminiBatch).toHaveBeenCalledTimes(1)
  const reqs = (submitGeminiBatch as any).mock.calls[0][1]
  expect(reqs).toHaveLength(1)
  expect(reqs[0].body).toEqual({ v: 2 })
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
