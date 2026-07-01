import { vi, test, expect, beforeEach } from 'vitest'
import { useAsyncJobStore } from '../stores/asyncJobStore'
import { useCanvasStore } from '../stores/canvasStore'
import { pollJobOnce, pollOpenAIJobOnce, configurePoller, setJobKey, resolveJobKey, clearJobKey, MAX_POLL_ERRORS } from './asyncJobPoller'
import type { AsyncJob } from '../stores/asyncJobStore'

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
  expect(useCanvasStore.getState().logs.some(l => l.includes('images ready'))).toBe(true)
})

test('pollJobOnce passes the request resolution into the cost computation (H9)', async () => {
  useAsyncJobStore.setState({ jobs: [{
    id: 'j1', projectId: 'p1', provider: 'gemini', modelId: 'gemini-3.1-flash-image-preview',
    opName: 'operations/x', status: 'submitted', submittedAt: 0,
    requests: [{ nodeId: 'nodeA', key: 'nodeA', meta: { prompt: 'cat', modelName: 'NB2', resolution: '4K' } }],
  }] })
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_SUCCEEDED',
    op: { entries: { nodeA: { response: {} } } } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  // (response, modelId, GEMINI_BATCH_DISCOUNT, resolution)
  expect(parseGenerateContentResponse).toHaveBeenCalledWith({}, 'gemini-3.1-flash-image-preview', 0.5, '4K')
})

test('pollJobOnce stamps the real usage/cost on the request (M2)', async () => {
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_SUCCEEDED',
    op: { entries: { nodeA: { response: {} } } } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  expect(useAsyncJobStore.getState().jobs[0].requests[0].usage?.cost_usd).toBe(0.02)
})

test('pollJobOnce marks a non-success terminal state as failed AND stamps the request error (node un-hang)', async () => {
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_FAILED',
    op: { error: { message: 'boom' }, entries: {} } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.status).toBe('failed')
  // request must carry the error so the node consumer fires (not left blank → stuck pending)
  expect(job.requests[0].error).toBe('boom')
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
  for (let i = 0; i < MAX_POLL_ERRORS; i++) await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.status).toBe('failed')
  expect(job.error).toBe('poll retries exhausted')
  // request stamped too → node surfaces the failure instead of hanging
  expect(job.requests[0].error).toBe('poll retries exhausted')
})

test('pollJobOnce LOGS the caught poll error instead of swallowing it (rule 12, H4)', async () => {
  ;(pollGeminiBatch as any).mockRejectedValue(new Error('network boom'))
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  expect(useCanvasStore.getState().logs.some(l => l.toLowerCase().includes('poll') && l.includes('boom'))).toBe(true)
})

test('MAX_POLL_ERRORS tolerates a multi-minute transient outage before failing a long batch (H4)', () => {
  // 10s poll interval × threshold must clear a few minutes so a brief blip does
  // not abandon a 24h batch.
  expect(MAX_POLL_ERRORS).toBeGreaterThanOrEqual(18) // >= 3 minutes
})

test('resolveJobKey returns the per-job submit key, falling back to the live getter (H3)', () => {
  configurePoller((p) => (p === 'openai' ? 'LIVE-OAI' : 'LIVE-GEM'))
  const gemJob = { id: 'jk', provider: 'gemini' } as AsyncJob
  // no per-job key yet → live getter
  expect(resolveJobKey(gemJob)).toBe('LIVE-GEM')
  // submit key wins → survives a live-key rotation mid-flight
  setJobKey('jk', 'SUBMIT-KEY')
  expect(resolveJobKey(gemJob)).toBe('SUBMIT-KEY')
  clearJobKey('jk')
  expect(resolveJobKey(gemJob)).toBe('LIVE-GEM')
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

test('pollOpenAIJobOnce marks a completed batch with no output file as failed + cleans up', async () => {
  seedOpenAIJob()
  ;(pollOpenAIBatch as any).mockResolvedValue({ done: true, status: 'completed', outputFileId: null })
  await pollOpenAIJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.status).toBe('failed')
  expect(job.error).toBe('OpenAI batch: no output file')
  expect(fetchOpenAIBatchResults).not.toHaveBeenCalled()
  expect(cleanupOpenAIBatch).toHaveBeenCalledWith('key', expect.objectContaining({ inputFileId: 'f1', refFileIds: [] }))
})
