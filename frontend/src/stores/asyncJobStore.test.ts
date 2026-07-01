import {
  useAsyncJobStore, selectJobForNode, pruneJobs, persistSafely,
  MAX_JOB_AGE_MS, MAX_PERSISTED_JOBS, type AsyncJob,
} from './asyncJobStore'

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

test('markConsumed drops the job when its last request is consumed', () => {
  useAsyncJobStore.getState().addJob({ ...baseJob, requests: [{ nodeId: 'solo', key: 'solo' }] })
  useAsyncJobStore.getState().markConsumed('job1', 'solo')
  expect(useAsyncJobStore.getState().jobs).toEqual([])
})

test('setPendingCount sets the reactive pending count', () => {
  useAsyncJobStore.getState().setPendingCount(3)
  expect(useAsyncJobStore.getState().pendingCount).toBe(3)
})

test('failJob stamps the error on unresolved requests and flips status (node un-hang fix)', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  useAsyncJobStore.getState().failJob('job1', 'deadline expired')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.status).toBe('failed')
  expect(job.error).toBe('deadline expired')
  expect(job.requests.map(r => r.error)).toEqual(['deadline expired', 'deadline expired'])
})

test('failJob never overwrites an already-resolved request', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  useAsyncJobStore.getState().setRequestResult('job1', 'nodeA', { resultMediaId: 'm1' })
  useAsyncJobStore.getState().failJob('job1', 'poll retries exhausted')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.requests.find(r => r.key === 'nodeA')?.resultMediaId).toBe('m1')
  expect(job.requests.find(r => r.key === 'nodeA')?.error).toBeUndefined()
  expect(job.requests.find(r => r.key === 'nodeB')?.error).toBe('poll retries exhausted')
})

test('a failed job stays failed when a request later resolves', () => {
  useAsyncJobStore.getState().addJob(baseJob)
  useAsyncJobStore.getState().updateJob('job1', { status: 'failed' })
  useAsyncJobStore.getState().setRequestResult('job1', 'nodeA', { resultMediaId: 'm1' })
  expect(useAsyncJobStore.getState().jobs[0].status).toBe('failed')
})

test('purging jobsForProject removes only that project (deleteProject contract, H7)', () => {
  const s = useAsyncJobStore.getState()
  s.addJob({ ...baseJob, id: 'j1', projectId: 'gone' })
  s.addJob({ ...baseJob, id: 'j2', projectId: 'keep' })
  s.addJob({ ...baseJob, id: 'j3', projectId: 'gone' })
  for (const j of s.jobsForProject('gone')) s.removeJob(j.id)
  expect(useAsyncJobStore.getState().jobs.map(j => j.id)).toEqual(['j2'])
})

describe('pruneJobs — bound the persisted set so localStorage cannot fill (quota fix)', () => {
  const NOW = 10_000_000_000
  const mk = (id: string, status: AsyncJob['status'], submittedAt: number): AsyncJob =>
    ({ id, projectId: 'p', provider: 'gemini', modelId: 'm', opName: '', status, submittedAt, requests: [{ nodeId: id, key: id }] })

  it('keeps active jobs (submitted/polling) regardless of age — recovery must survive', () => {
    const jobs = [mk('a', 'submitted', NOW - MAX_JOB_AGE_MS * 5), mk('b', 'polling', 0)]
    expect(pruneJobs(jobs, NOW).map(j => j.id).sort()).toEqual(['a', 'b'])
  })

  it('drops terminal jobs older than MAX_JOB_AGE_MS (orphaned, never consumed)', () => {
    const jobs = [mk('old', 'failed', NOW - MAX_JOB_AGE_MS - 1), mk('done-old', 'done', NOW - MAX_JOB_AGE_MS - 1)]
    expect(pruneJobs(jobs, NOW)).toEqual([])
  })

  it('keeps terminal jobs still within the age window', () => {
    const jobs = [mk('recent', 'failed', NOW - 1000), mk('done', 'done', NOW - 1000)]
    expect(pruneJobs(jobs, NOW).map(j => j.id).sort()).toEqual(['done', 'recent'])
  })

  it('count backstop: keeps every active job + only the newest terminal up to the cap', () => {
    const active = Array.from({ length: 3 }, (_, i) => mk(`act${i}`, 'polling', NOW - i))
    const terminal = Array.from({ length: MAX_PERSISTED_JOBS + 50 }, (_, i) => mk(`t${i}`, 'done', NOW - i))
    const kept = pruneJobs([...active, ...terminal], NOW)
    // all 3 active survive
    expect(kept.filter(j => j.status === 'polling')).toHaveLength(3)
    // total never exceeds the cap (active counted within it)
    expect(kept.length).toBeLessThanOrEqual(MAX_PERSISTED_JOBS)
    // the newest terminal (t0) is kept, an old one well past the cap is dropped
    const ids = new Set(kept.map(j => j.id))
    expect(ids.has('t0')).toBe(true)
    expect(ids.has(`t${MAX_PERSISTED_JOBS + 49}`)).toBe(false)
  })
})

describe('addJob prunes stale terminal jobs before appending (within-session bound)', () => {
  it('drops an ancient failed job when a new job is added', () => {
    const ancientFailed: AsyncJob = {
      id: 'ancient', projectId: 'p', provider: 'gemini', modelId: 'm', opName: '',
      status: 'failed', submittedAt: 1, requests: [{ nodeId: 'x', key: 'x' }],
    }
    useAsyncJobStore.setState({ jobs: [ancientFailed] })
    useAsyncJobStore.getState().addJob({
      id: 'new', projectId: 'p', provider: 'gemini', modelId: 'm', opName: '',
      status: 'submitted', submittedAt: Date.now(), requests: [{ nodeId: 'y', key: 'y' }],
    })
    expect(useAsyncJobStore.getState().jobs.map(j => j.id)).toEqual(['new'])
  })
})

describe('persistSafely — a full localStorage must never crash the canvas (quota symptom)', () => {
  it('swallows a QuotaExceededError instead of throwing', () => {
    const throwing = { setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e } }
    expect(() => persistSafely('k', 'v', throwing)).not.toThrow()
  })

  it('writes through to the backend on the happy path', () => {
    const calls: Array<[string, string]> = []
    persistSafely('k', 'v', { setItem: (n, v) => { calls.push([n, v]) } })
    expect(calls).toEqual([['k', 'v']])
  })
})

describe('selectJobForNode — newest RESOLVED job wins, never shadowed by an older one (H8)', () => {
  const job = (id: string, submittedAt: number, req: AsyncJob['requests']): AsyncJob =>
    ({ id, projectId: 'p1', provider: 'gemini', modelId: 'm', opName: '', status: 'submitted', submittedAt, requests: req })

  it('returns undefined when no job references the node', () => {
    expect(selectJobForNode([job('j1', 1, [{ nodeId: 'other', key: 'other' }])], 'x')).toBeUndefined()
  })

  it('prefers a resolved job over an older still-pending job for the same node (no stuck-pending)', () => {
    const older = job('old', 1000, [{ nodeId: 'x', key: 'x' }])                       // pending
    const newer = job('new', 2000, [{ nodeId: 'x', key: 'x', resultMediaId: 'm9' }])  // resolved
    expect(selectJobForNode([older, newer], 'x')?.id).toBe('new')
    // order in the array must not matter
    expect(selectJobForNode([newer, older], 'x')?.id).toBe('new')
  })

  it('among multiple resolved jobs, returns the newest by submittedAt (no stale image)', () => {
    const a = job('a', 1000, [{ nodeId: 'x', key: 'x', resultMediaId: 'm1' }])
    const b = job('b', 3000, [{ nodeId: 'x', key: 'x', resultMediaId: 'm3' }])
    const c = job('c', 2000, [{ nodeId: 'x', key: 'x', error: 'boom' }])
    expect(selectJobForNode([a, b, c], 'x')?.id).toBe('b')
  })

  it('falls back to a pending job when none is resolved yet', () => {
    const p = job('p', 1000, [{ nodeId: 'x', key: 'x' }])
    expect(selectJobForNode([p], 'x')?.id).toBe('p')
  })

  it('a NEWER pending run is NOT shadowed by an OLDER already-resolved leftover job (stale-job fix)', () => {
    // Real failure mode: a resolved job lingered in the persisted store (never
    // consumed). The user starts a fresh run → a new pending job. The consumer
    // must wait for the NEW job, not render the old leftover image.
    const leftover = job('leftover', 1000, [{ nodeId: 'x', key: 'x', resultMediaId: 'old-img' }])
    const fresh = job('fresh', 2000, [{ nodeId: 'x', key: 'x' }]) // pending
    expect(selectJobForNode([leftover, fresh], 'x')?.id).toBe('fresh')
    expect(selectJobForNode([fresh, leftover], 'x')?.id).toBe('fresh')
  })
})
