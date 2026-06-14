import { useAsyncJobStore } from './asyncJobStore'

beforeEach(() => useAsyncJobStore.setState({ jobs: [] }))

const baseJob = {
  id: 'job1', projectId: 'p1', provider: 'gemini' as const, modelId: 'gemini-3.1-flash-image-preview',
  opName: 'operations/abc', status: 'submitted' as const, submittedAt: 1000,
  requests: [{ nodeId: 'nodeA', key: 'nodeA' }, { nodeId: 'nodeB', key: 'nodeB' }],
}

test('addJob then activeJobs returns it', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  expect(useAsyncJobStore.getState().activeJobs().map(j => j.id)).toEqual(['job1'])
})

test('setRequestResult fills one entry; job flips done when all resolved', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  useAsyncJobStore.getState().setRequestResult('job1', 'nodeA', { resultMediaId: 'm1' })
  expect(useAsyncJobStore.getState().jobs[0].status).toBe('polling')
  useAsyncJobStore.getState().setRequestResult('job1', 'nodeB', { resultMediaId: 'm2' })
  expect(useAsyncJobStore.getState().jobs[0].status).toBe('done')
})

test('jobsForProject filters by projectId', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  useAsyncJobStore.getState().addJob({ ...baseJob, id: 'job2', projectId: 'p2' })
  expect(useAsyncJobStore.getState().jobsForProject('p1').map(j => j.id)).toEqual(['job1'])
})

test('removeJob drops it', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  useAsyncJobStore.getState().removeJob('job1')
  expect(useAsyncJobStore.getState().jobs).toEqual([])
})

test('markConsumed removes one request entry', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  useAsyncJobStore.getState().markConsumed('job1', 'nodeA')
  expect(useAsyncJobStore.getState().jobs[0].requests.map(r => r.key)).toEqual(['nodeB'])
})

test('a failed job stays failed when a request later resolves', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  useAsyncJobStore.getState().updateJob('job1', { status: 'failed' })
  useAsyncJobStore.getState().setRequestResult('job1', 'nodeA', { resultMediaId: 'm1' })
  expect(useAsyncJobStore.getState().jobs[0].status).toBe('failed')
})
