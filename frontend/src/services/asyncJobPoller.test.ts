import { vi, test, expect, beforeEach } from 'vitest'
import { useAsyncJobStore } from '../stores/asyncJobStore'
import { pollJobOnce, pollOpenAIJobOnce } from './asyncJobPoller'

vi.mock('../mediaStore', () => ({ saveMediaForProject: vi.fn().mockResolvedValue(undefined), generateMediaId: () => 'm-x' }))
vi.mock('./applyImageResult', () => ({ applyImageResult: vi.fn().mockResolvedValue({ mediaId: 'm-x' }) }))
vi.mock('../providers/geminiBatchPath', () => ({
  pollGeminiBatch: vi.fn(),
  extractAllInlineEntries: (op: any) => new Map(Object.entries(op.entries)),
  GEMINI_BATCH_DISCOUNT: 0.5,
}))
vi.mock('../providers/geminiShared', () => ({
  parseGenerateContentResponse: vi.fn(() => ({ image_b64: 'AAAA', status: 'ok', usage: { cost_usd: 0.02 } })),
}))
vi.mock('../providers/openaiBatchPath', () => ({
  pollOpenAIBatch: vi.fn(),
  fetchOpenAIBatchResults: vi.fn(),
  cleanupOpenAIBatch: vi.fn().mockResolvedValue(undefined),
}))

import { pollGeminiBatch } from '../providers/geminiBatchPath'
import { parseGenerateContentResponse } from '../providers/geminiShared'
import { pollOpenAIBatch, fetchOpenAIBatchResults, cleanupOpenAIBatch } from '../providers/openaiBatchPath'
import { applyImageResult } from './applyImageResult'

beforeEach(() => {
  vi.clearAllMocks()
  useAsyncJobStore.setState({ jobs: [{
    id: 'j1', projectId: 'p1', provider: 'gemini', modelId: 'gemini-3.1-flash-image-preview',
    opName: 'operations/x', status: 'submitted', submittedAt: 0,
    requests: [{ nodeId: 'nodeA', key: 'nodeA', meta: { prompt: 'cat', modelName: 'NB2' } }],
  }] })
})

test('pollJobOnce routes a finished entry to a mediaId', async () => {
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_SUCCEEDED',
    op: { entries: { nodeA: { response: {} } } } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.status).toBe('done')
  expect(job.requests[0].resultMediaId).toBe('m-x')
  expect(applyImageResult).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'cat', modelName: 'NB2' }))
})

test('pollJobOnce marks a non-success terminal state as failed', async () => {
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_FAILED',
    op: { error: { message: 'boom' }, entries: {} } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  expect(useAsyncJobStore.getState().jobs[0].status).toBe('failed')
})

test('pollJobOnce increments pollErrors on poll failure', async () => {
  ;(pollGeminiBatch as any).mockRejectedValue(new Error('network'))
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  expect(useAsyncJobStore.getState().jobs[0].pollErrors).toBe(1)
})

test('pollJobOnce routes a missing batch entry to an error', async () => {
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_SUCCEEDED', op: { entries: {} } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  expect(useAsyncJobStore.getState().jobs[0].requests[0].error).toBe('missing batch entry')
})

test('pollJobOnce routes an entry-level error', async () => {
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_SUCCEEDED',
    op: { entries: { nodeA: { error: { message: 'entry blew up' } } } } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  expect(useAsyncJobStore.getState().jobs[0].requests[0].error).toBe('entry blew up')
})

test('pollJobOnce routes a null image_b64 to an error', async () => {
  vi.mocked(parseGenerateContentResponse).mockReturnValueOnce({ image_b64: null, status: 'quota exceeded' } as any)
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_SUCCEEDED',
    op: { entries: { nodeA: { response: {} } } } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  expect(useAsyncJobStore.getState().jobs[0].requests[0].error).toBe('quota exceeded')
})

test('pollJobOnce flips to failed after MAX_POLL_ERRORS rejecting ticks', async () => {
  ;(pollGeminiBatch as any).mockRejectedValue(new Error('network'))
  for (let i = 0; i < 6; i++) await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.status).toBe('failed')
  expect(job.error).toBe('poll retries exhausted')
})

function seedOpenAIJob() {
  useAsyncJobStore.setState({ jobs: [{
    id: 'b1', projectId: 'p1', provider: 'openai', modelId: 'gpt-image-2',
    opName: '', status: 'submitted', submittedAt: 0,
    requests: [{ nodeId: 'nA', key: 'nA' }],
    openai: { batchId: 'b1', inputFileId: 'f1', refFileIds: [] },
  }] })
}

test('pollOpenAIJobOnce routes a completed batch result to a mediaId + cleans up', async () => {
  seedOpenAIJob()
  ;(pollOpenAIBatch as any).mockResolvedValue({ done: true, status: 'completed', outputFileId: 'out1' })
  ;(fetchOpenAIBatchResults as any).mockResolvedValue(new Map([['nA', { image_b64: 'AAAA', status: 'OK' }]]))
  await pollOpenAIJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.requests[0].resultMediaId).toBe('m-x')
  expect(job.status).toBe('done')
  expect(cleanupOpenAIBatch).toHaveBeenCalledWith('key', expect.objectContaining({ inputFileId: 'f1', outputFileId: 'out1', refFileIds: [] }))
})

test('pollOpenAIJobOnce marks an expired batch as failed + cleans up', async () => {
  seedOpenAIJob()
  ;(pollOpenAIBatch as any).mockResolvedValue({ done: true, status: 'expired', outputFileId: null })
  await pollOpenAIJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.status).toBe('failed')
  expect(job.error).toBe('OpenAI batch expired')
  expect(cleanupOpenAIBatch).toHaveBeenCalled()
})
