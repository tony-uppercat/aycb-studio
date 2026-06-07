import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BatchJobView,
  BatchPendingRequest,
  GenerateImageBatchNodeData,
} from '../../types'

const API = ''   // same origin via Vite proxy
const POLL_MS = 10_000

interface SubmitResponse {
  job_id: string
  google_job_name: string
  state: 'running'
  count: number
  cost_estimate: number
}

/**
 * Bundle queue + auto-submit + recovery + polling for Generate Image Batch node.
 *
 * - addToBundle: snapshot current settings into pending[], (re)arms idle timer.
 * - When pending.length >= bundleN -> submit immediately.
 * - When idle for bundleT seconds -> submit.
 * - submitNow: manual override.
 * - On mount: GET /api/batch/jobs?node_id=X (recovery).
 * - While any job is running: poll every POLL_MS.
 */
export function useGenerateImageBatch(
  nodeId: string,
  data: GenerateImageBatchNodeData,
  _selected: boolean,
) {
  const [pending, setPending] = useState<BatchPendingRequest[]>(data.pending ?? [])
  const [jobs, setJobs] = useState<BatchJobView[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // memo feedback_fetch_bind: bind window so refs survive vitest fake timers
  const fetchRef = useRef<typeof fetch>(
    typeof window !== 'undefined' && window.fetch
      ? window.fetch.bind(window)
      : fetch,
  )

  const bundleN = data.bundleN ?? 5
  const bundleT = data.bundleT ?? 30

  const refreshJobs = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const resp = await fetchRef.current(
        `${API}/api/batch/jobs?node_id=${encodeURIComponent(nodeId)}`,
        { signal: ctrl.signal },
      )
      if (!resp.ok) return
      const body = await resp.json()
      setJobs(body.jobs ?? [])
    } catch {
      // aborted or transient — ignore
    }
  }, [nodeId])

  const doSubmit = useCallback(async (reqs: BatchPendingRequest[]) => {
    if (reqs.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        node_id: nodeId,
        model: data.selectedModel,
        requests: reqs.map(r => ({
          key: r.key,
          prompt: r.prompt,
          refs_b64: r.refs_b64,
          refs_mime: r.refs_mime,
          aspect_ratio: r.aspect_ratio,
          resolution: r.resolution,
          thinking: r.thinking,
          grounding: r.grounding,
        })),
      }
      const resp = await fetchRef.current(`${API}/api/batch/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok) {
        const txt = typeof resp.text === 'function' ? await resp.text() : ''
        throw new Error(`HTTP ${resp.status}: ${txt}`)
      }
      const sub: SubmitResponse = await resp.json()
      setPending(prev => prev.filter(p => !reqs.find(r => r.key === p.key)))
      void refreshJobs()
      return sub
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }, [nodeId, data.selectedModel, refreshJobs])

  const armIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      setPending(prev => {
        if (prev.length > 0) void doSubmit(prev)
        return prev
      })
    }, bundleT * 1000)
  }, [bundleT, doSubmit])

  const addToBundle = useCallback(() => {
    const snapshot: BatchPendingRequest = {
      key: `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: data.prompt,
      refs_b64: [],
      refs_mime: [],
      aspect_ratio: data.aspectRatio,
      resolution: data.resolution,
      thinking: data.thinking ?? false,
      grounding: data.grounding ?? false,
      added_at: Date.now(),
    }
    setPending(prev => {
      const next = [...prev, snapshot]
      if (next.length >= bundleN) {
        void doSubmit(next)
      }
      return next
    })
    armIdleTimer()
  }, [data.prompt, data.aspectRatio, data.resolution, data.thinking, data.grounding, bundleN, doSubmit, armIdleTimer])

  const submitNow = useCallback(async () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    await doSubmit(pending)
  }, [doSubmit, pending])

  const clearPending = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    setPending([])
  }, [])

  const cancelJob = useCallback(async (jobId: string) => {
    try {
      await fetchRef.current(`${API}/api/batch/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
      })
    } finally {
      void refreshJobs()
    }
  }, [refreshJobs])

  // Hydrate + cleanup
  useEffect(() => {
    void refreshJobs()
    return () => {
      abortRef.current?.abort()
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [refreshJobs])

  // Poll while any job is running
  useEffect(() => {
    const hasRunning = jobs.some(j => j.state === 'running')
    if (!hasRunning) return
    const id = setInterval(() => { void refreshJobs() }, POLL_MS)
    return () => clearInterval(id)
  }, [jobs, refreshJobs])

  return {
    pending,
    jobs,
    submitting,
    error,
    addToBundle,
    submitNow,
    clearPending,
    cancelJob,
    refreshJobs,
  }
}
