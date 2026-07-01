import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { STORAGE_KEYS } from '../storage/keys'

export interface AsyncJobRequest {
  nodeId: string
  key: string
  resultMediaId?: string
  error?: string
  /** Real usage/cost from the batch response, stamped by the poller. The consumer
   *  logs THIS (already resolution-correct + batch-discounted) instead of
   *  re-estimating from live node state. (M2) */
  usage?: { input_tokens: number; output_tokens: number; cost_usd?: number }
  /** Generation metadata carried from enqueue time so the poller can persist PNG meta + bridge. */
  meta?: { prompt: string; modelName: string; resolution?: string; aspectRatio?: string }
}

export type AsyncJobStatus = 'submitted' | 'polling' | 'done' | 'failed'

export interface AsyncJob {
  id: string
  projectId: string
  provider: 'gemini' | 'openai'
  modelId: string
  opName: string
  status: AsyncJobStatus
  submittedAt: number
  requests: AsyncJobRequest[]
  error?: string
  pollErrors?: number
  /** Last upstream-batch lifecycle state (e.g. OpenAI: 'validating'|'in_progress'|
   *  'finalizing'|'completed'; Gemini: BATCH_STATE_*). Written by the poller on
   *  every tick so the node UI can render "Batch · in_progress · 18m" instead
   *  of a generic spinner. Runtime+persisted (recovery survives reload). */
  batchStatus?: string
  /** UTC ms when the user pressed Cancel; the poller skips this job and the
   *  consumer treats it as failed. */
  cancelledAt?: number
  /** OpenAI-only: file ids for polling the batch + cleaning up afterwards. */
  openai?: {
    batchId: string
    inputFileId: string
    refFileIds: string[]
    outputFileId?: string
  }
}

interface AsyncJobState {
  jobs: AsyncJob[]
  /** Reactive count of requests still buffered in the bundler (pre-submit). Runtime-only, not persisted. */
  pendingCount: number
  setPendingCount: (n: number) => void
  addJob: (job: AsyncJob) => void
  updateJob: (id: string, patch: Partial<AsyncJob>) => void
  setRequestResult: (id: string, key: string, patch: { resultMediaId?: string; error?: string; usage?: AsyncJobRequest['usage'] }) => void
  failJob: (id: string, error: string) => void
  markConsumed: (id: string, key: string) => void
  markCancelled: (id: string) => void
  removeJob: (id: string) => void
  jobsForProject: (projectId: string) => AsyncJob[]
  activeJobs: () => AsyncJob[]
}

/**
 * Pick the job a node's consumer effect should act on: the NEWEST job (by
 * `submittedAt`, wall-clock ms) that references this node.
 *
 * A node can transiently appear in more than one job. "Newest wins" is correct
 * in both directions:
 *  - an older still-pending job + a newer resolved one → render the newer (no
 *    stuck-pending). (H8)
 *  - an older already-resolved LEFTOVER (persisted, never consumed) + a fresh
 *    pending run → wait for the fresh run, don't render the stale image.
 *
 * Requires `submittedAt` to be a monotonic wall-clock stamp (Date.now), NOT
 * performance.now — the latter resets each reload and the store is persisted,
 * so a leftover job could otherwise out-rank a fresh one.
 */
export function selectJobForNode(jobs: AsyncJob[], nodeId: string): AsyncJob | undefined {
  const matching = jobs.filter(j => j.requests.some(r => r.nodeId === nodeId))
  if (!matching.length) return undefined
  return matching.reduce((a, b) => (b.submittedAt > a.submittedAt ? b : a))
}

// ── Persistence bound (quota guard) ─────────────────────────────────────────
// Terminal jobs whose result no node ever consumed (node deleted before the
// batch resolved, or a whole-batch failure nobody is mounted to read) are never
// pruned by markConsumed — they would otherwise pile up in `aycb_async_jobs`
// forever until localStorage throws QuotaExceededError. Cap the persisted set:
// active jobs are always kept (recovery must survive reload); terminal jobs age
// out, with a hard count backstop against runaway accumulation.
export const MAX_JOB_AGE_MS = 48 * 60 * 60 * 1000  // 48h — covers OpenAI's 24h batch SLA + margin
export const MAX_PERSISTED_JOBS = 100

const isActiveJob = (j: AsyncJob): boolean => j.status === 'submitted' || j.status === 'polling'

export function pruneJobs(jobs: AsyncJob[], now: number): AsyncJob[] {
  const fresh = jobs.filter(j => isActiveJob(j) || now - j.submittedAt < MAX_JOB_AGE_MS)
  if (fresh.length <= MAX_PERSISTED_JOBS) return fresh
  // Over the cap: never drop a recoverable active job; evict the oldest terminal.
  const active = fresh.filter(isActiveJob)
  const terminal = fresh.filter(j => !isActiveJob(j)).sort((a, b) => b.submittedAt - a.submittedAt)
  const room = Math.max(0, MAX_PERSISTED_JOBS - active.length)
  return [...active, ...terminal.slice(0, room)]
}

/** localStorage.setItem that never throws: on a full quota (or private-mode
 *  write block) the in-memory store stays authoritative and we skip durability
 *  for this tick rather than crash the canvas. Surfaced, not swallowed (Rule 12). */
export function persistSafely(
  name: string,
  value: string,
  backend: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    backend.setItem(name, value)
  } catch (e) {
    console.warn(`[AYCB] persist skipped for "${name}" (${(e as Error)?.name ?? 'write error'})`)
  }
}

// Shared by any persisted store that must degrade to "no persist" rather than
// crash the canvas when localStorage is full (e.g. canvasStore's aycb_ui).
export const safeStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => persistSafely(name, value),
  removeItem: (name) => localStorage.removeItem(name),
}

function recomputeStatus(job: AsyncJob): AsyncJobStatus {
  if (job.status === 'failed') return 'failed'
  const allResolved = job.requests.every(r => r.resultMediaId || r.error)
  if (allResolved) return 'done'
  const anyResolved = job.requests.some(r => r.resultMediaId || r.error)
  return anyResolved ? 'polling' : job.status
}

export const useAsyncJobStore = create<AsyncJobState>()(
  persist(
    (set, get) => ({
      jobs: [],
      pendingCount: 0,
      setPendingCount: (n) => set({ pendingCount: n }),
      addJob: (job) => set(s => ({ jobs: pruneJobs([...s.jobs, job], Date.now()) })),
      updateJob: (id, patch) => set(s => ({ jobs: s.jobs.map(j => j.id === id ? { ...j, ...patch } : j) })),
      setRequestResult: (id, key, patch) => set(s => ({
        jobs: s.jobs.map(j => {
          if (j.id !== id) return j
          const requests = j.requests.map(r => r.key === key ? { ...r, ...patch } : r)
          const next = { ...j, requests }
          return { ...next, status: recomputeStatus(next) }
        }),
      })),
      // Fail a job AND propagate the error to every still-unresolved request.
      // The node consumer keys off req.error/req.resultMediaId — a job-level
      // 'failed' alone leaves its requests blank, so the node hangs forever with
      // no image and no error. Stamping the requests lets the node surface the
      // failure and clear its pending flag.
      failJob: (id, error) => set(s => ({
        jobs: s.jobs.map(j => {
          if (j.id !== id) return j
          const requests = j.requests.map(r => (r.resultMediaId || r.error) ? r : { ...r, error })
          return { ...j, status: 'failed' as AsyncJobStatus, error, requests }
        }),
      })),
      markConsumed: (id, key) => set(s => ({
        jobs: s.jobs.flatMap(j => {
          if (j.id !== id) return [j]
          const requests = j.requests.filter(r => r.key !== key)
          return requests.length === 0 ? [] : [{ ...j, requests }]
        }),
      })),
      markCancelled: (id) => set(s => ({
        jobs: s.jobs.map(j => {
          if (j.id !== id) return j
          const requests = j.requests.map(r => r.resultMediaId || r.error ? r : { ...r, error: 'cancelled by user' })
          return { ...j, status: 'failed' as AsyncJobStatus, error: 'cancelled by user', cancelledAt: Date.now(), requests }
        }),
      })),
      removeJob: (id) => set(s => ({ jobs: s.jobs.filter(j => j.id !== id) })),
      jobsForProject: (projectId) => get().jobs.filter(j => j.projectId === projectId),
      activeJobs: () => get().jobs.filter(j => j.status === 'submitted' || j.status === 'polling'),
    }),
    {
      name: STORAGE_KEYS.ASYNC_JOBS,
      // Quota-safe write: a full localStorage degrades to "no persist" not a crash.
      storage: createJSONStorage(() => safeStorage),
      // Persist only recovery essentials. Never base64 — image bytes live in mediaStore.
      partialize: (state) => ({ jobs: state.jobs }),
      // Drop stale terminal jobs left by prior sessions at load — bounds the set
      // that would otherwise grow until it exceeds the localStorage quota.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<AsyncJobState>),
        jobs: pruneJobs((persisted as { jobs?: AsyncJob[] } | undefined)?.jobs ?? [], Date.now()),
      }),
    }
  )
)
