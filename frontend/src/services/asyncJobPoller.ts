import { useAsyncJobStore, type AsyncJob } from '../stores/asyncJobStore'
import { pollGeminiBatch, extractAllInlineEntries, GEMINI_BATCH_DISCOUNT } from '../providers/geminiBatchPath'
import { pollOpenAIBatch, fetchOpenAIBatchResults, cleanupOpenAIBatch } from '../providers/openaiBatchPath'
import { parseGenerateContentResponse } from '../providers/geminiShared'
import { useCanvasStore } from '../stores/canvasStore'
import { applyImageResult } from './applyImageResult'

const POLL_MS = 10_000
const MAX_POLL_ERRORS = 6
/** Last logged state per job id — guards against re-logging the same state every 10s tick. */
const _lastState = new Map<string, string>()
let _started = false
let _timer: ReturnType<typeof setTimeout> | null = null
let _keyGetter: (p: 'gemini' | 'openai') => string = () => ''

/** Inject the provider-aware API key source (called once from App). */
export function configurePoller(getKey: (p: 'gemini' | 'openai') => string) { _keyGetter = getKey }

/** Poll one job a single tick; on terminal success, save images + route results per request. */
export async function pollJobOnce(job: AsyncJob, apiKey: string): Promise<void> {
  const store = useAsyncJobStore.getState()
  try {
    const { done, op, state } = await pollGeminiBatch(job.opName, apiKey)
    if (state && state !== _lastState.get(job.id)) {
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · ${state || (done ? 'done' : 'polling')}`)
      _lastState.set(job.id, state)
    }
    if (!done) { store.updateJob(job.id, { status: 'polling', pollErrors: 0 }); return }
    if (state !== 'BATCH_STATE_SUCCEEDED') {
      store.updateJob(job.id, { status: 'failed', error: op?.error?.message ?? state })
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · FAILED ${op?.error?.message ?? state}`)
      _lastState.delete(job.id)
      return
    }
    const entries = extractAllInlineEntries(op)
    for (const req of job.requests) {
      const entry = entries.get(req.key)
      if (!entry) { store.setRequestResult(job.id, req.key, { error: 'missing batch entry' }); continue }
      if (entry.error) { store.setRequestResult(job.id, req.key, { error: entry.error.message ?? 'entry error' }); continue }
      const result = parseGenerateContentResponse(entry.response, job.modelId, GEMINI_BATCH_DISCOUNT)
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
        })
        store.setRequestResult(job.id, req.key, { resultMediaId: mediaId })
      } catch (e) {
        store.setRequestResult(job.id, req.key, { error: e instanceof Error ? e.message : 'save failed' })
      }
    }
    useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · ${job.requests.length} images ready`)
    _lastState.delete(job.id)
  } catch {
    const live = useAsyncJobStore.getState().jobs.find(j => j.id === job.id)
    const errs = (live?.pollErrors ?? 0) + 1
    store.updateJob(job.id, { pollErrors: errs, ...(errs >= MAX_POLL_ERRORS ? { status: 'failed', error: 'poll retries exhausted' } : {}) })
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
    if (!done) { store.updateJob(job.id, { status: 'polling', pollErrors: 0 }); return }
    if (status !== 'completed') {
      store.updateJob(job.id, { status: 'failed', error: `OpenAI batch ${status}` })
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · FAILED OpenAI batch ${status}`)
      _lastState.delete(job.id)
      await cleanupOpenAIBatch(apiKey, { inputFileId: job.openai.inputFileId, outputFileId: outputFileId ?? undefined, refFileIds: job.openai.refFileIds })
      return
    }
    if (!outputFileId) {
      store.updateJob(job.id, { status: 'failed', error: 'OpenAI batch: no output file' })
      useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · FAILED OpenAI batch: no output file`)
      _lastState.delete(job.id)
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
        })
        store.setRequestResult(job.id, req.key, { resultMediaId: mediaId })
      } catch (e) {
        store.setRequestResult(job.id, req.key, { error: e instanceof Error ? e.message : 'save failed' })
      }
    }
    useCanvasStore.getState().addLog(`[batch] ${job.id.slice(-8)} · ${job.requests.length} images ready`)
    _lastState.delete(job.id)
    await cleanupOpenAIBatch(apiKey, { inputFileId: job.openai.inputFileId, outputFileId, refFileIds: job.openai.refFileIds })
  } catch {
    const live = useAsyncJobStore.getState().jobs.find(j => j.id === job.id)
    const errs = (live?.pollErrors ?? 0) + 1
    const exhausted = errs >= MAX_POLL_ERRORS
    store.updateJob(job.id, { pollErrors: errs, ...(exhausted ? { status: 'failed', error: 'poll retries exhausted' } : {}) })
    if (exhausted && job.openai) {
      await cleanupOpenAIBatch(apiKey, { inputFileId: job.openai.inputFileId, outputFileId: job.openai.outputFileId, refFileIds: job.openai.refFileIds })
    }
  }
}

/** Poll every active job in parallel, once — dispatching by provider. */
export async function pollAllActive(): Promise<void> {
  const jobs = useAsyncJobStore.getState().activeJobs()
  const geminiKey = _keyGetter('gemini')
  const openaiKey = _keyGetter('openai')
  await Promise.all(jobs.map(j => {
    if (j.provider === 'gemini') { if (!geminiKey) return Promise.resolve(); return pollJobOnce(j, geminiKey) }
    if (j.provider === 'openai') { if (!openaiKey) return Promise.resolve(); return pollOpenAIJobOnce(j, openaiKey) }
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

export function stopAsyncJobPoller(): void {
  if (_timer) clearTimeout(_timer)
  _started = false
}
