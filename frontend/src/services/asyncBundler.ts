import { submitGeminiBatch } from '../providers/geminiBatchPath'
import { useAsyncJobStore } from '../stores/asyncJobStore'
import { useCanvasStore } from '../stores/canvasStore'

export const MAX_BUNDLE_BYTES = 18 * 1024 * 1024   // 18MB, under Google's 20MB inline cap
const MAX_BUNDLE_COUNT = 50
const DEBOUNCE_MS = 2500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PendingRequest { nodeId: string; key: string; body: Record<string, any>; bytes: number; modelId: string }

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
let _keyGetter: () => string = () => ''

/** Inject the Gemini API key source (called once from App). */
export function configureBundler(getKey: () => string) { _keyGetter = getKey }

/** Enqueue one ASY request; schedules a debounced flush for its model bucket. */
export function enqueueAsyncRequest(req: PendingRequest): void {
  const list = (buckets.get(req.modelId) ?? []).filter(r => r.nodeId !== req.nodeId)
  list.push(req)
  buckets.set(req.modelId, list)
  const existing = timers.get(req.modelId)
  if (existing) clearTimeout(existing)
  timers.set(req.modelId, setTimeout(() => void flushModel(req.modelId), DEBOUNCE_MS))
}

/** Flush one model bucket now: chunk -> submit -> addJob per chunk. */
export async function flushModel(modelId: string): Promise<void> {
  const list = buckets.get(modelId) ?? []
  buckets.delete(modelId)
  const t = timers.get(modelId); if (t) clearTimeout(t); timers.delete(modelId)
  if (list.length === 0) return
  const projectId = useCanvasStore.getState().activeProjectId ?? 'unknown'
  const apiKey = _keyGetter()
  const chunks = chunkBySize(list)
  for (const chunk of chunks) {
    try {
      const opName = await submitGeminiBatch(modelId, chunk.map(r => ({ body: r.body, key: r.key })), apiKey)
      useAsyncJobStore.getState().addJob({
        id: opName, projectId, provider: 'gemini', modelId, opName,
        status: 'submitted', submittedAt: performance.now(),
        requests: chunk.map(r => ({ nodeId: r.nodeId, key: r.key })),
      })
    } catch (e) {
      console.warn('[AYCB] async bundle submit failed:', e)
      const msg = e instanceof Error ? e.message : 'submit failed'
      useAsyncJobStore.getState().addJob({
        id: `failed-${chunk.map(c => c.key).join('-')}`,
        projectId, provider: 'gemini', modelId, opName: '',
        status: 'failed', submittedAt: performance.now(),
        requests: chunk.map(r => ({ nodeId: r.nodeId, key: r.key, error: msg })),
      })
    }
  }
}

/** Manual "Run queue now" — flush every model bucket. */
export async function flushAll(): Promise<void> {
  while (buckets.size) await Promise.all([...buckets.keys()].map(m => flushModel(m)))
}
