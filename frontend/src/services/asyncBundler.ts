import { submitGeminiBatch } from '../providers/geminiBatchPath'
import { submitOpenAIBatch } from '../providers/openaiBatchPath'
import { useAsyncJobStore } from '../stores/asyncJobStore'
import { useCanvasStore } from '../stores/canvasStore'

export const MAX_BUNDLE_BYTES = 18 * 1024 * 1024   // 18MB, under Google's 20MB inline cap
const MAX_BUNDLE_COUNT = 50
const DEBOUNCE_MS = 2500

export interface PendingRequest {
  nodeId: string
  key: string                 // custom_id / metadata key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>
  bytes: number
  modelId: string
  provider: 'gemini' | 'openai'
  bundleKey: string           // bucket key: gemini=modelId, openai=`${modelId}|gen|edits`
  apiKey: string              // live provider key captured at enqueue time (used at flush)
  refs?: File[]               // openai edits refs
  /** Generation metadata forwarded onto the job request so the poller can persist meta + bridge. */
  meta?: { prompt: string; modelName: string; resolution?: string; aspectRatio?: string }
}

/** Group items into chunks under the byte/count cap. Order preserved. An oversize single item gets its own chunk. */
export function chunkBySize<T extends { bytes: number }>(items: T[]): T[][] {
  const chunks: T[][] = []
  let cur: T[] = []
  let curBytes = 0
  for (const it of items) {
    const wouldExceed = curBytes + it.bytes > MAX_BUNDLE_BYTES || cur.length >= MAX_BUNDLE_COUNT
    if (cur.length > 0 && wouldExceed) { chunks.push(cur); cur = []; curBytes = 0 }
    cur.push(it); curBytes += it.bytes
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

const buckets = new Map<string, PendingRequest[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Enqueue one ASY request; schedules a debounced flush for its bundle bucket. */
export function enqueueAsyncRequest(req: PendingRequest): void {
  const list = (buckets.get(req.bundleKey) ?? []).filter(r => r.nodeId !== req.nodeId)
  list.push(req)
  buckets.set(req.bundleKey, list)
  const existing = timers.get(req.bundleKey)
  if (existing) clearTimeout(existing)
  timers.set(req.bundleKey, setTimeout(() => void flushModel(req.bundleKey), DEBOUNCE_MS))
}

/** Flush one bundle bucket now: chunk -> submit -> addJob per chunk. */
export async function flushModel(bundleKey: string): Promise<void> {
  const list = buckets.get(bundleKey) ?? []
  buckets.delete(bundleKey)
  const t = timers.get(bundleKey); if (t) clearTimeout(t); timers.delete(bundleKey)
  if (list.length === 0) return
  const projectId = useCanvasStore.getState().activeProjectId ?? 'unknown'
  const apiKey = list[0].apiKey
  const chunks = chunkBySize(list)
  for (const chunk of chunks) {
    const modelId = chunk[0].modelId
    const provider = chunk[0].provider
    try {
      if (provider === 'openai') {
        const { batchId, inputFileId, refFileIds } = await submitOpenAIBatch(
          chunk.map(r => ({ customId: r.key, body: r.body, refs: r.refs })), apiKey)
        useAsyncJobStore.getState().addJob({
          id: batchId, projectId, provider: 'openai', modelId, opName: '',
          status: 'submitted', submittedAt: performance.now(),
          requests: chunk.map(r => ({ nodeId: r.nodeId, key: r.key, meta: r.meta })),
          openai: { batchId, inputFileId, refFileIds },
        })
        useCanvasStore.getState().addLog(`[batch] submit · ${chunk.length} req · ${modelId} · ${batchId.slice(-8)}`)
      } else {
        const opName = await submitGeminiBatch(modelId, chunk.map(r => ({ body: r.body, key: r.key })), apiKey)
        useAsyncJobStore.getState().addJob({
          id: opName, projectId, provider: 'gemini', modelId, opName,
          status: 'submitted', submittedAt: performance.now(),
          requests: chunk.map(r => ({ nodeId: r.nodeId, key: r.key, meta: r.meta })),
        })
        useCanvasStore.getState().addLog(`[batch] submit · ${chunk.length} req · ${modelId} · ${opName.slice(-8)}`)
      }
    } catch (e) {
      console.warn('[AYCB] async bundle submit failed:', e)
      const msg = e instanceof Error ? e.message : 'submit failed'
      useCanvasStore.getState().addLog(`[batch] submit FAILED · ${modelId} · ${msg}`)
      useAsyncJobStore.getState().addJob({
        id: `failed-${chunk.map(c => c.key).join('-')}`,
        projectId, provider, modelId, opName: '',
        status: 'failed', submittedAt: performance.now(),
        requests: chunk.map(r => ({ nodeId: r.nodeId, key: r.key, meta: r.meta, error: msg })),
      })
    }
  }
}

/** Manual "Run queue now" — flush every bundle bucket. */
export async function flushAll(): Promise<void> {
  while (buckets.size) await Promise.all([...buckets.keys()].map(m => flushModel(m)))
}
