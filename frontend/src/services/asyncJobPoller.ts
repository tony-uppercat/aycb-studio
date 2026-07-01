import { useAsyncJobStore, type AsyncJob } from '../stores/asyncJobStore'
import { pollGeminiBatch, extractAllInlineEntries, GEMINI_BATCH_DISCOUNT, cancelGeminiBatch } from '../providers/geminiBatchPath'
import { pollOpenAIBatch, fetchOpenAIBatchResults, cleanupOpenAIBatch, cancelOpenAIBatch } from '../providers/openaiBatchPath'
import { parseGenerateContentResponse } from '../providers/geminiShared'
import { useCanvasStore } from '../stores/canvasStore'
import { applyImageResult } from './applyImageResult'
import { logPerfEvent } from '../utils/perfLogger'

function emitTurnaround(job: AsyncJob, ok: boolean, finalStatus?: string): void {
  logPerfEvent('async-batch', Date.now() - job.submittedAt, {
    provider: job.provider,
    model: job.modelId,
    ok,
    status: finalStatus ?? job.status,
    requests: job.requests.length,
  })
}

const POLL_MS = 10_000
/** ~5 min of consecutive 10s poll failures before abandoning a job. High enough
 *  that a brief network blip / 429 burst does not kill a long-running (24h)
 *  batch; pollErrors resets to 0 on any successful tick. (H4) */
export const MAX_POLL_ERRORS = 30
/** Last logged state per job id — guards against re-logging the same state every 10s tick. */
const _lastState = new Map<string, string>()
/** Per-job API key captured at SUBMIT time, runtime-only (NEVER persisted — keys
 *  must never hit localStorage). A job polled with the key it was submitted under
 *  survives a live-key rotation; recovered jobs (post-reload, map empty) fall back
 *  to the live key. (H3) */
const _jobKeys = new Map<string, string>()
let _started = false
let _timer: ReturnType<typeof setTimeout> | null = null
let _keyGetter: (p: 'gemini' | 'openai') => string = () => ''

/** Inject the provider-aware API key source (called once from App). */
export function configurePoller(getKey: (p: 'gemini' | 'openai') => string) { _keyGetter = getKey }

/** Record the key a job was submitted under (called by the bundler after submit). */
export function setJobKey(jobId: string, key: string) { _jobKeys.set(jobId, key) }
/** Drop a job's captured key (terminal state / removal). */
export function clearJobKey(jobId: string) { _jobKeys.delete(jobId) }
/** The key to poll a job with: its own submit key, else the live key for its provider. */
export function resolveJobKey(job: AsyncJob): string { return _jobKeys.get(job.id) || _keyGetter(job.provider) }

/** Poll one job a single tick; on terminal success, save images + route results per request. */
export async function pollJobOnce(job: AsyncJob, apiKey: string): Promise<void> {
  const store = useAsyncJobStore.getState()
  try {
    const { done, op, state } = await pollGeminiBatch(job.opName, apiKey)
    if (state && state !== _lastState.get(job.id)) {
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · ${state || (done ? 'done' : 'polling')}`)
      _lastState.set(job.id, state)
    }
    if (!done) { store.updateJob(job.id, { status: 'polling', pollErrors: 0, batchStatus: state || 'polling' }); return }
    if (state !== 'BATCH_STATE_SUCCEEDED') {
      store.failJob(job.id, op?.error?.message ?? state)
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · FAILED ${op?.error?.message ?? state}`)
      _lastState.delete(job.id)
      clearJobKey(job.id)
      emitTurnaround(job, false, state)
      return
    }
    const entries = extractAllInlineEntries(op)
    for (const req of job.requests) {
      const entry = entries.get(req.key)
      if (!entry) { store.setRequestResult(job.id, req.key, { error: 'missing batch entry' }); continue }
      if (entry.error) { store.setRequestResult(job.id, req.key, { error: entry.error.message ?? 'entry error' }); continue }
      // H9: feed the request resolution so the embedded + console cost match the real tier.
      const result = parseGenerateContentResponse(entry.response, job.modelId, GEMINI_BATCH_DISCOUNT, req.meta?.resolution ?? '')
      if (!result.image_b64) { store.setRequestResult(job.id, req.key, { error: result.status }); continue }
      try {
        const { mediaId } = await applyImageResult({
          nodeId: req.nodeId,
          result,
          prompt: req.meta?.prompt ?? '',
          model: job.modelId,
          modelName: req.meta?.modelName ?? job.modelId,
          resolution: req.meta?.resolution,
          aspectRatio: req.meta?.aspectRatio,
          projectId: job.projectId,
        })
        store.setRequestResult(job.id, req.key, { resultMediaId: mediaId, usage: result.usage })
      } catch (e) {
        store.setRequestResult(job.id, req.key, { error: e instanceof Error ? e.message : 'save failed' })
      }
    }
    useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · ${job.requests.length} images ready`)
    _lastState.delete(job.id)
    clearJobKey(job.id)
    emitTurnaround(job, true, 'BATCH_STATE_SUCCEEDED')
  } catch (e) {
    const live = useAsyncJobStore.getState().jobs.find(j => j.id === job.id)
    const errs = (live?.pollErrors ?? 0) + 1
    const exhausted = errs >= MAX_POLL_ERRORS
    const msg = e instanceof Error ? e.message : 'poll error'
    // Rule 12: never swallow — surface every transient poll failure to the Console.
    useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · poll error (${errs}/${MAX_POLL_ERRORS}) ${msg}`)
    store.updateJob(job.id, { pollErrors: errs })
    if (exhausted) {
      store.failJob(job.id, 'poll retries exhausted')
      _lastState.delete(job.id); clearJobKey(job.id); emitTurnaround(job, false, 'poll-retries-exhausted')
    }
  }
}

/** Poll one OpenAI batch job a single tick; on terminal success, save images + route results. */
export async function pollOpenAIJobOnce(job: AsyncJob, apiKey: string): Promise<void> {
  const store = useAsyncJobStore.getState()
  if (!job.openai) return
  try {
    const { done, status, outputFileId } = await pollOpenAIBatch(job.openai.batchId, apiKey)
    if (status && status !== _lastState.get(job.id)) {
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · ${status}`)
      _lastState.set(job.id, status)
    }
    if (!done) { store.updateJob(job.id, { status: 'polling', pollErrors: 0, batchStatus: status || 'polling' }); return }
    if (status !== 'completed') {
      store.failJob(job.id, `OpenAI batch ${status}`)
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · FAILED OpenAI batch ${status}`)
      _lastState.delete(job.id)
      clearJobKey(job.id)
      emitTurnaround(job, false, status)
      await cleanupOpenAIBatch(apiKey, { inputFileId: job.openai.inputFileId, outputFileId: outputFileId ?? undefined, refFileIds: job.openai.refFileIds })
      return
    }
    if (!outputFileId) {
      store.failJob(job.id, 'OpenAI batch: no output file')
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · FAILED OpenAI batch: no output file`)
      _lastState.delete(job.id)
      clearJobKey(job.id)
      emitTurnaround(job, false, 'no-output-file')
      await cleanupOpenAIBatch(apiKey, { inputFileId: job.openai.inputFileId, refFileIds: job.openai.refFileIds })
      return
    }
    store.updateJob(job.id, { openai: { ...job.openai, outputFileId } })
    const results = await fetchOpenAIBatchResults(outputFileId, apiKey)
    for (const req of job.requests) {
      const result = results.get(req.key)
      if (!result) { store.setRequestResult(job.id, req.key, { error: 'missing batch entry' }); continue }
      if (!result.image_b64) { store.setRequestResult(job.id, req.key, { error: result.status }); continue }
      try {
        const { mediaId } = await applyImageResult({
          nodeId: req.nodeId,
          result,
          prompt: req.meta?.prompt ?? '',
          model: job.modelId,
          modelName: req.meta?.modelName ?? job.modelId,
          resolution: req.meta?.resolution,
          aspectRatio: req.meta?.aspectRatio,
          projectId: job.projectId,
        })
        store.setRequestResult(job.id, req.key, { resultMediaId: mediaId, usage: result.usage })
      } catch (e) {
        store.setRequestResult(job.id, req.key, { error: e instanceof Error ? e.message : 'save failed' })
      }
    }
    useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · ${job.requests.length} images ready`)
    _lastState.delete(job.id)
    clearJobKey(job.id)
    emitTurnaround(job, true, 'completed')
    await cleanupOpenAIBatch(apiKey, { inputFileId: job.openai.inputFileId, outputFileId, refFileIds: job.openai.refFileIds })
  } catch (e) {
    const live = useAsyncJobStore.getState().jobs.find(j => j.id === job.id)
    const errs = (live?.pollErrors ?? 0) + 1
    const exhausted = errs >= MAX_POLL_ERRORS
    const msg = e instanceof Error ? e.message : 'poll error'
    useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · poll error (${errs}/${MAX_POLL_ERRORS}) ${msg}`)
    store.updateJob(job.id, { pollErrors: errs })
    if (exhausted) {
      store.failJob(job.id, 'poll retries exhausted')
      _lastState.delete(job.id)
      clearJobKey(job.id)
      emitTurnaround(job, false, 'poll-retries-exhausted')
      // L1: read the LIVE job — outputFileId is written to the store before the
      // download, so the local `job` snapshot would miss it and leak the file.
      const oa = live?.openai ?? job.openai
      if (oa) {
        await cleanupOpenAIBatch(apiKey, { inputFileId: oa.inputFileId, outputFileId: oa.outputFileId, refFileIds: oa.refFileIds })
      }
    }
  }
}

/** Poll every active job in parallel, once — dispatching by provider, each with
 *  the key it was submitted under (falls back to the live key). (H3) */
export async function pollAllActive(): Promise<void> {
  const jobs = useAsyncJobStore.getState().activeJobs()
  await Promise.all(jobs.map(j => {
    if (j.cancelledAt) return Promise.resolve()
    const key = resolveJobKey(j)
    if (!key) return Promise.resolve()
    if (j.provider === 'gemini') return pollJobOnce(j, key)
    if (j.provider === 'openai') return pollOpenAIJobOnce(j, key)
    return Promise.resolve()
  }))
}

/** Start the background loop once (idempotent). Recovers persisted jobs naturally. */
export function startAsyncJobPoller(): void {
  if (_started) return
  _started = true
  const tick = async () => {
    await pollAllActive().catch(() => { /* per-job handled */ })
    _timer = setTimeout(tick, POLL_MS)
  }
  void tick()
}

/** Cancel a running async batch: tell the upstream (best-effort), mark the
 *  local job failed, clean up OpenAI files. Returns immediately — remote cancel
 *  can take minutes on OpenAI and any in-flight requests may still bill. */
export async function cancelJob(jobId: string): Promise<void> {
  const job = useAsyncJobStore.getState().jobs.find(j => j.id === jobId)
  if (!job) return
  const store = useAsyncJobStore.getState()
  store.markCancelled(jobId)
  useCanvasStore.getState().addLog(`[batch] ${jobId.slice(-8)} · CANCELLED by user`)
  _lastState.delete(jobId)
  const key = resolveJobKey(job)
  if (job.provider === 'openai' && job.openai && key) {
    void cancelOpenAIBatch(job.openai.batchId, key).then(() =>
      cleanupOpenAIBatch(key, {
        inputFileId: job.openai!.inputFileId,
        outputFileId: job.openai!.outputFileId,
        refFileIds: job.openai!.refFileIds,
      })
    )
  } else if (job.provider === 'gemini' && key) {
    void cancelGeminiBatch(job.opName, key)
  }
  clearJobKey(jobId)
}

export function stopAsyncJobPoller(): void {
  if (_timer) clearTimeout(_timer)
  _started = false
}
