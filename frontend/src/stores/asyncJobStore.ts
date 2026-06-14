import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '../storage/keys'

export interface AsyncJobRequest {
  nodeId: string
  key: string
  resultMediaId?: string
  error?: string
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
  addJob: (job: AsyncJob) => void
  updateJob: (id: string, patch: Partial<AsyncJob>) => void
  setRequestResult: (id: string, key: string, patch: { resultMediaId?: string; error?: string }) => void
  markConsumed: (id: string, key: string) => void
  removeJob: (id: string) => void
  jobsForProject: (projectId: string) => AsyncJob[]
  activeJobs: () => AsyncJob[]
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
      addJob: (job) => set(s => ({ jobs: [...s.jobs, job] })),
      updateJob: (id, patch) => set(s => ({ jobs: s.jobs.map(j => j.id === id ? { ...j, ...patch } : j) })),
      setRequestResult: (id, key, patch) => set(s => ({
        jobs: s.jobs.map(j => {
          if (j.id !== id) return j
          const requests = j.requests.map(r => r.key === key ? { ...r, ...patch } : r)
          const next = { ...j, requests }
          return { ...next, status: recomputeStatus(next) }
        }),
      })),
      markConsumed: (id, key) => set(s => ({
        jobs: s.jobs.flatMap(j => {
          if (j.id !== id) return [j]
          const requests = j.requests.filter(r => r.key !== key)
          return requests.length === 0 ? [] : [{ ...j, requests }]
        }),
      })),
      removeJob: (id) => set(s => ({ jobs: s.jobs.filter(j => j.id !== id) })),
      jobsForProject: (projectId) => get().jobs.filter(j => j.projectId === projectId),
      activeJobs: () => get().jobs.filter(j => j.status === 'submitted' || j.status === 'polling'),
    }),
    {
      name: STORAGE_KEYS.ASYNC_JOBS,
      // Persist only recovery essentials. Never base64 — image bytes live in mediaStore.
      partialize: (state) => ({ jobs: state.jobs }),
    }
  )
)
