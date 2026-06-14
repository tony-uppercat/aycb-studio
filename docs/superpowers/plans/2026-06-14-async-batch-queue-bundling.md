# Async Batch Queue + Bundling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ASY (Batch API −50%) image generation non-blocking: submit returns immediately, a background poller follows jobs, results route back per node, jobs recover on reload, and same-model requests bundle into one submission.

**Architecture:** Split the batch lifecycle into `submit` (fast) + `poll` (background). A persisted zustand job store holds in-flight bundles; a singleton poller polls all jobs in parallel and saves images to mediaStore; a bundler accumulates same-model requests (debounce + 20MB chunking) into one `requests[]` submission; `useGenerateImage` enqueues then returns, and a node effect consumes its result via a shared `applyImageResult` helper.

**Tech Stack:** TypeScript, React 19, Zustand 5 (persist middleware), @xyflow/react, Vitest, Gemini `:batchGenerateContent` REST.

**Spec:** [docs/superpowers/specs/2026-06-14-async-batch-queue-bundling-design.md](../specs/2026-06-14-async-batch-queue-bundling-design.md)

---

## File Structure

- Create `frontend/src/stores/asyncJobStore.ts` — persisted job records + actions.
- Create `frontend/src/services/asyncBundler.ts` — per-model request accumulator, debounce, 20MB chunking, flush.
- Create `frontend/src/services/asyncJobPoller.ts` — singleton poller, parallel poll, mediaStore save, per-entry routing, recovery.
- Create `frontend/src/services/applyImageResult.ts` — shared result→(mediaId/save/meta/bridge/history/cost) helper used by sync run AND async consumer.
- Modify `frontend/src/providers/geminiBatchPath.ts` — split into `submitGeminiBatch`, `pollGeminiBatch`, `extractAllInlineEntries`; keep `runGeminiBatch` wrapper.
- Modify `frontend/src/nodes/generate-image/useGenerateImage.ts` — async branch enqueues + returns; effect consumes job result.
- Modify `frontend/src/App.tsx` — start the poller once on mount (recovery).
- Tests: `asyncJobStore.test.ts`, `asyncBundler.test.ts`, `asyncJobPoller.test.ts`, `geminiBatchPath.test.ts` (extend), `applyImageResult.test.ts`.
- Smoke: `scripts/smoke_test_gemini_batch_bundle.py` (live N=3 routing gate).

**Conventions:** snake_case is the project default for data fields, BUT existing
adjacent types (`CostEntry`, `GenerateImageResult`) are camelCase. New job-store
fields stay **camelCase** to match the zustand/React side of the codebase. Run
`cd frontend && npx vitest run <file>` after each implementation step.

---

## Task 1: Split the Gemini batch path (submit / poll / extract-all)

**Files:**
- Modify: `frontend/src/providers/geminiBatchPath.ts`
- Test: `frontend/src/providers/geminiBatchPath.test.ts`

- [ ] **Step 1: Write failing test for `extractAllInlineEntries`**

Add to `geminiBatchPath.test.ts`:

```ts
import { extractAllInlineEntries } from './geminiBatchPath'

test('extractAllInlineEntries maps every inlined entry by metadata key', () => {
  const op = {
    response: { inlinedResponses: { inlinedResponses: [
      { metadata: { key: 'nodeA' }, response: { candidates: [{ content: { parts: [{ text: 'A' }] } }] } },
      { metadata: { key: 'nodeB' }, response: { candidates: [{ content: { parts: [{ text: 'B' }] } }] } },
    ] } },
  }
  const map = extractAllInlineEntries(op)
  expect([...map.keys()].sort()).toEqual(['nodeA', 'nodeB'])
  expect(map.get('nodeA').response.candidates[0].content.parts[0].text).toBe('A')
})

test('extractAllInlineEntries falls back to index keys when metadata is missing', () => {
  const op = { response: { inlinedResponses: { inlinedResponses: [{ response: {} }] } } }
  const map = extractAllInlineEntries(op)
  expect(map.has('0')).toBe(true)
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd frontend && npx vitest run src/providers/geminiBatchPath.test.ts -t extractAllInlineEntries`
Expected: FAIL — `extractAllInlineEntries is not a function`.

- [ ] **Step 3: Implement `extractAllInlineEntries` and split submit/poll**

In `geminiBatchPath.ts`, add (keep existing `extractInlineEntry`, `runGeminiBatch`):

```ts
/** All inlined entries from a finished op, keyed by metadata.key (fallback: index). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractAllInlineEntries(op: any): Map<string, any> {
  const inlined = op?.response?.inlinedResponses
  const arr = Array.isArray(inlined) ? inlined : inlined?.inlinedResponses
  const out = new Map<string, any>()
  if (!Array.isArray(arr)) return out
  arr.forEach((entry: any, i: number) => {
    const key = entry?.metadata?.key ?? String(i)
    out.set(String(key), entry)
  })
  return out
}

/** Submit N inline requests as one batch; returns the operation name. */
export async function submitGeminiBatch(
  modelId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requests: { body: Record<string, any>; key: string }[],
  apiKey: string,
): Promise<string> {
  const headers = { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }
  const submitResp = await fetch(`${BASE}/models/${modelId}:batchGenerateContent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      batch: {
        display_name: `aycb-async-${requests.length}`,
        input_config: { requests: { requests: requests.map(r => ({ request: r.body, metadata: { key: r.key } })) } },
      },
    }),
  })
  if (!submitResp.ok) throw new Error(`Gemini batch submit failed: ${await googleError(submitResp)}`)
  const opName = (await submitResp.json()).name as string
  if (!opName) throw new Error('Gemini batch submit returned no operation name')
  return opName
}

/** One poll tick. Returns done flag + the raw op when terminal. */
export async function pollGeminiBatch(
  opName: string,
  apiKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ done: boolean; op?: any; state: string }> {
  const headers = { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }
  const pollResp = await fetch(`${BASE}/${opName}`, { headers })
  if (!pollResp.ok) throw new Error(`Gemini batch poll failed: ${await googleError(pollResp)}`)
  const op = await pollResp.json()
  const state = op.metadata?.state ?? ''
  const done = Boolean(op.done) || TERMINAL.has(state)
  return { done, op, state }
}
```

Note: `display_name` no longer uses `Date.now()` (forbidden in some contexts and not needed for uniqueness — the server assigns the op name).

- [ ] **Step 4: Run tests, verify pass**

Run: `cd frontend && npx vitest run src/providers/geminiBatchPath.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/providers/geminiBatchPath.ts frontend/src/providers/geminiBatchPath.test.ts
git commit -m "[refactor] geminiBatchPath: split submit/poll, add extractAllInlineEntries"
```

---

## Task 2: Async job store

**Files:**
- Create: `frontend/src/stores/asyncJobStore.ts`
- Test: `frontend/src/stores/asyncJobStore.test.ts`
- Reference: `frontend/src/storage/keys.ts` (add a key)

- [ ] **Step 1: Add a storage key**

In `frontend/src/storage/keys.ts`, add inside `STORAGE_KEYS`:

```ts
  ASYNC_JOBS: 'aycb_async_jobs',
```

- [ ] **Step 2: Write the failing test**

Create `asyncJobStore.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test, verify fails**

Run: `cd frontend && npx vitest run src/stores/asyncJobStore.test.ts`
Expected: FAIL — cannot find module `./asyncJobStore`.

- [ ] **Step 4: Implement the store**

Create `asyncJobStore.ts`:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { STORAGE_KEYS } from '../storage/keys'

export interface AsyncJobRequest {
  nodeId: string
  key: string
  resultMediaId?: string
  error?: string
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
  /** Consecutive poll errors — drives backoff/failure. */
  pollErrors?: number
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
        jobs: s.jobs.map(j => j.id === id
          ? { ...j, requests: j.requests.filter(r => r.key !== key) }
          : j),
      })).valueOf() ?? undefined,
      removeJob: (id) => set(s => ({ jobs: s.jobs.filter(j => j.id !== id) })),
      jobsForProject: (projectId) => get().jobs.filter(j => j.projectId === projectId),
      activeJobs: () => get().jobs.filter(j => j.status === 'submitted' || j.status === 'polling'),
    }),
    {
      name: STORAGE_KEYS.ASYNC_JOBS,
      // Persist only what recovery needs. Never base64 — bytes live in mediaStore.
      partialize: (state) => ({ jobs: state.jobs }),
    }
  )
)
```

Note: simplify `markConsumed` to a plain set (remove the `.valueOf()` artifact):

```ts
      markConsumed: (id, key) => set(s => ({
        jobs: s.jobs.map(j => j.id === id ? { ...j, requests: j.requests.filter(r => r.key !== key) } : j),
      })),
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd frontend && npx vitest run src/stores/asyncJobStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/asyncJobStore.ts frontend/src/stores/asyncJobStore.test.ts frontend/src/storage/keys.ts
git commit -m "[feat] asyncJobStore: persisted batch job records"
```

---

## Task 3: Shared result applier (`applyImageResult`)

Extract the result-handling tail of `runSingle` so the async consumer reuses it.

**Files:**
- Create: `frontend/src/services/applyImageResult.ts`
- Test: `frontend/src/services/applyImageResult.test.ts`

- [ ] **Step 1: Write the failing test**

Create `applyImageResult.test.ts`:

```ts
import { vi, test, expect, beforeEach } from 'vitest'
import { applyImageResult } from './applyImageResult'

vi.mock('../mediaStore', () => ({
  generateMediaId: () => 'media-123',
  saveMediaForProject: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../utils/reviewStatus', () => ({ saveMediaMeta: vi.fn(), registerBridgeStem: vi.fn() }))
vi.mock('../api', () => ({ bridgeMedia: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => vi.clearAllMocks())

test('applyImageResult saves media and returns the new mediaId', async () => {
  const b64 = 'iVBORw0KGgo='   // tiny valid-ish base64
  const out = await applyImageResult({
    nodeId: 'n1',
    result: { image_b64: b64, status: 'ok', usage: { cost_usd: 0.05 } },
    prompt: 'cat', model: 'gemini-3.1-flash-image-preview', modelName: 'Nano Banana 2',
    resolution: '1K',
  })
  expect(out.mediaId).toBe('media-123')
})
```

- [ ] **Step 2: Run test, verify fails**

Run: `cd frontend && npx vitest run src/services/applyImageResult.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `applyImageResult`**

Create `applyImageResult.ts` (mirrors `runSingle`'s tail; pure of React state):

```ts
import type { GenerateImageResult } from '../types'
import { generateMediaId, saveMediaForProject } from '../mediaStore'
import { bridgeMedia } from '../api'
import { saveMediaMeta, registerBridgeStem } from '../utils/reviewStatus'

export interface ApplyImageContext {
  nodeId: string
  result: GenerateImageResult
  prompt: string
  model: string
  modelName: string
  resolution?: string
  aspectRatio?: string
}

/** Persist a generated image (mediaStore + meta + bridge). Returns the mediaId. */
export async function applyImageResult(ctx: ApplyImageContext): Promise<{ mediaId: string }> {
  const { nodeId, result, prompt, model, modelName, resolution, aspectRatio } = ctx
  if (!result.image_b64) throw new Error(result.status || 'No image generated')
  const mediaId = generateMediaId()

  const response = await fetch(`data:image/png;base64,${result.image_b64}`)
  const blob = await response.blob()
  const file = new File([blob], `generated_${nodeId}.png`, { type: 'image/png' })
  await saveMediaForProject(mediaId, file)

  saveMediaMeta(mediaId, {
    prompt, model, model_name: modelName,
    aspect_ratio: aspectRatio || undefined,
    image_size: resolution || undefined,
    cost_usd: result.usage?.cost_usd,
    generated_at: new Date().toISOString(),
  })

  if (result.bridge_stem) {
    registerBridgeStem(mediaId, result.bridge_stem)
  } else {
    bridgeMedia(result.image_b64, mediaId, {
      prompt, model, modelName,
      aspectRatio: aspectRatio || undefined,
      imageSize: resolution || undefined,
      costUsd: result.usage?.cost_usd,
    }).catch(() => { /* silent */ })
  }
  return { mediaId }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cd frontend && npx vitest run src/services/applyImageResult.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `runSingle` to use it (regression-guarded)**

In `useGenerateImage.ts` `runSingle`, replace the block from `const mediaId = generateMediaId()` through the `bridgeMedia(...).catch(...)` (the meta/bridge tail) with:

```ts
    setImageB64(r.image_b64)
    const { mediaId } = await applyImageResult({
      nodeId: id, result: r, prompt, model: selectedModel, modelName: modelInfo.name,
      resolution: currentResolution || undefined, aspectRatio: currentAspectRatio || undefined,
    })
    setActiveMediaId(mediaId)
```

Add import: `import { applyImageResult } from '../../services/applyImageResult'`.
Keep the history/cost block below unchanged.

- [ ] **Step 6: Run the full generate-image tests, verify pass**

Run: `cd frontend && npx vitest run src/nodes/generate-image`
Expected: PASS (no behavior change for sync path).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/services/applyImageResult.ts frontend/src/services/applyImageResult.test.ts frontend/src/nodes/generate-image/useGenerateImage.ts
git commit -m "[refactor] extract applyImageResult; runSingle reuses it"
```

---

## Task 4: Async job poller (background, parallel, recovery)

**Files:**
- Create: `frontend/src/services/asyncJobPoller.ts`
- Test: `frontend/src/services/asyncJobPoller.test.ts`

- [ ] **Step 1: Write the failing test (one tick: done → routes results)**

Create `asyncJobPoller.test.ts`:

```ts
import { vi, test, expect, beforeEach } from 'vitest'
import { useAsyncJobStore } from '../stores/asyncJobStore'
import { pollJobOnce } from './asyncJobPoller'

vi.mock('../mediaStore', () => ({ saveMediaForProject: vi.fn().mockResolvedValue(undefined), generateMediaId: () => 'm-x' }))
vi.mock('../providers/geminiBatchPath', () => ({
  pollGeminiBatch: vi.fn(),
  extractAllInlineEntries: (op: any) => new Map(Object.entries(op.entries)),
}))
vi.mock('../providers/geminiShared', () => ({
  parseGenerateContentResponse: () => ({ image_b64: 'AAAA', status: 'ok', usage: { cost_usd: 0.02 } }),
}))

import { pollGeminiBatch } from '../providers/geminiBatchPath'

beforeEach(() => {
  vi.clearAllMocks()
  useAsyncJobStore.setState({ jobs: [{
    id: 'j1', projectId: 'p1', provider: 'gemini', modelId: 'gemini-3.1-flash-image-preview',
    opName: 'operations/x', status: 'submitted', submittedAt: 0,
    requests: [{ nodeId: 'nodeA', key: 'nodeA' }],
  }] })
})

test('pollJobOnce routes a finished entry to a mediaId', async () => {
  ;(pollGeminiBatch as any).mockResolvedValue({ done: true, state: 'BATCH_STATE_SUCCEEDED',
    op: { entries: { nodeA: { response: {} } } } })
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  const job = useAsyncJobStore.getState().jobs[0]
  expect(job.status).toBe('done')
  expect(job.requests[0].resultMediaId).toBe('m-x')
})

test('pollJobOnce increments pollErrors on poll failure', async () => {
  ;(pollGeminiBatch as any).mockRejectedValue(new Error('network'))
  await pollJobOnce(useAsyncJobStore.getState().jobs[0], 'key')
  expect(useAsyncJobStore.getState().jobs[0].pollErrors).toBe(1)
})
```

- [ ] **Step 2: Run test, verify fails**

Run: `cd frontend && npx vitest run src/services/asyncJobPoller.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the poller**

Create `asyncJobPoller.ts`:

```ts
import { useAsyncJobStore, type AsyncJob } from '../stores/asyncJobStore'
import { useSettingsStore } from '../stores/settingsStore' // see Step 3a note
import { pollGeminiBatch, extractAllInlineEntries } from '../providers/geminiBatchPath'
import { parseGenerateContentResponse } from '../providers/geminiShared'
import { saveMediaForProject, generateMediaId } from '../mediaStore'
import { GEMINI_BATCH_DISCOUNT } from '../providers/geminiBatchPath'

const POLL_MS = 10_000
const MAX_POLL_ERRORS = 6
let _started = false
let _timer: ReturnType<typeof setTimeout> | null = null

/** Resolve the Gemini API key for polling. Replace with the app's key source. */
function geminiKey(): string {
  return useSettingsStore.getState().geminiApiKey ?? ''
}

/** Poll one job a single tick; on terminal success, save images + route results. */
export async function pollJobOnce(job: AsyncJob, apiKey: string): Promise<void> {
  const store = useAsyncJobStore.getState()
  try {
    const { done, op, state } = await pollGeminiBatch(job.opName, apiKey)
    if (!done) { store.updateJob(job.id, { status: 'polling', pollErrors: 0 }); return }
    if (state !== 'BATCH_STATE_SUCCEEDED') {
      store.updateJob(job.id, { status: 'failed', error: op?.error?.message ?? state })
      return
    }
    const entries = extractAllInlineEntries(op)
    for (const req of job.requests) {
      const entry = entries.get(req.key)
      if (!entry) { store.setRequestResult(job.id, req.key, { error: 'missing batch entry' }); continue }
      if (entry.error) { store.setRequestResult(job.id, req.key, { error: entry.error.message ?? 'entry error' }); continue }
      const result = parseGenerateContentResponse(entry.response, job.modelId, GEMINI_BATCH_DISCOUNT)
      if (!result.image_b64) { store.setRequestResult(job.id, req.key, { error: result.status }); continue }
      const mediaId = generateMediaId()
      const resp = await fetch(`data:image/png;base64,${result.image_b64}`)
      const file = new File([await resp.blob()], `generated_${req.nodeId}.png`, { type: 'image/png' })
      await saveMediaForProject(mediaId, file)
      // Stash usage on the request via store patch (cost applied by node consumer).
      store.setRequestResult(job.id, req.key, { resultMediaId: mediaId })
    }
  } catch {
    const errs = (job.pollErrors ?? 0) + 1
    store.updateJob(job.id, { pollErrors: errs, ...(errs >= MAX_POLL_ERRORS ? { status: 'failed', error: 'poll retries exhausted' } : {}) })
  }
}

/** Poll every active job in parallel, once. */
export async function pollAllActive(): Promise<void> {
  const jobs = useAsyncJobStore.getState().activeJobs()
  const key = geminiKey()
  await Promise.all(jobs.filter(j => j.provider === 'gemini').map(j => pollJobOnce(j, key)))
}

/** Start the background loop once (idempotent). Call on app mount → recovery. */
export function startAsyncJobPoller(): void {
  if (_started) return
  _started = true
  const tick = async () => {
    await pollAllActive().catch(() => { /* logged per-job */ })
    _timer = setTimeout(tick, POLL_MS)
  }
  _timer = setTimeout(tick, POLL_MS)
}

export function stopAsyncJobPoller(): void {
  if (_timer) clearTimeout(_timer)
  _started = false
}
```

- [ ] **Step 3a: Resolve the API-key import**

`geminiKey()` above assumes `useSettingsStore.geminiApiKey`. Before implementing,
confirm the real key source: run `cd frontend && grep -rn "apiKey" src/components/SettingsContext.tsx | head`.
If keys live in `SettingsContext` (React-only), instead expose the key by having
`startAsyncJobPoller(getKey: () => string)` take a getter, and pass it from
`App.tsx` where the settings hook is available. Update `geminiKey()` usage to the
injected getter. (Pick whichever matches the codebase; the getter form is safer.)

- [ ] **Step 4: Run tests, verify pass**

Run: `cd frontend && npx vitest run src/services/asyncJobPoller.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/asyncJobPoller.ts frontend/src/services/asyncJobPoller.test.ts
git commit -m "[feat] asyncJobPoller: parallel background poll + per-entry routing"
```

---

## Task 5: Request bundler (per-model, debounce, 20MB chunking)

**Files:**
- Create: `frontend/src/services/asyncBundler.ts`
- Test: `frontend/src/services/asyncBundler.test.ts`

- [ ] **Step 1: Write the failing test (chunking + grouping are pure)**

Create `asyncBundler.test.ts`:

```ts
import { test, expect } from 'vitest'
import { chunkBySize, MAX_BUNDLE_BYTES } from './asyncBundler'

test('chunkBySize splits when estimated bytes exceed the cap', () => {
  const big = 'x'.repeat(MAX_BUNDLE_BYTES * 0.6)   // ~0.6 cap each
  const items = [
    { key: 'a', body: { p: big }, bytes: MAX_BUNDLE_BYTES * 0.6 },
    { key: 'b', body: { p: big }, bytes: MAX_BUNDLE_BYTES * 0.6 },
    { key: 'c', body: { p: 'small' }, bytes: 10 },
  ]
  const chunks = chunkBySize(items)
  expect(chunks.length).toBe(2)         // a alone, then b+c
  expect(chunks[0].map(i => i.key)).toEqual(['a'])
  expect(chunks[1].map(i => i.key)).toEqual(['b', 'c'])
})

test('chunkBySize keeps everything in one chunk when under cap', () => {
  const items = [{ key: 'a', body: {}, bytes: 1 }, { key: 'b', body: {}, bytes: 1 }]
  expect(chunkBySize(items).length).toBe(1)
})
```

- [ ] **Step 2: Run test, verify fails**

Run: `cd frontend && npx vitest run src/services/asyncBundler.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the bundler**

Create `asyncBundler.ts`:

```ts
import { submitGeminiBatch } from '../providers/geminiBatchPath'
import { useAsyncJobStore } from '../stores/asyncJobStore'
import { useCanvasStore } from '../stores/canvasStore'

export const MAX_BUNDLE_BYTES = 18 * 1024 * 1024   // 18MB, under Google's 20MB inline cap
const MAX_BUNDLE_COUNT = 50
const DEBOUNCE_MS = 2500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface PendingRequest { nodeId: string; key: string; body: Record<string, any>; bytes: number; modelId: string }

/** Group pending requests into chunks under the size/count cap (order preserved). */
export function chunkBySize(items: { key: string; bytes: number }[]): { key: string; bytes: number }[][] {
  const chunks: any[][] = []
  let cur: any[] = []
  let curBytes = 0
  for (const it of items) {
    const wouldExceed = curBytes + it.bytes > MAX_BUNDLE_BYTES || cur.length >= MAX_BUNDLE_COUNT
    if (cur.length > 0 && wouldExceed) { chunks.push(cur); cur = []; curBytes = 0 }
    cur.push(it); curBytes += it.bytes
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

// Buckets keyed by modelId.
const buckets = new Map<string, PendingRequest[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let _keyGetter: () => string = () => ''

/** Inject the Gemini API key source (set once from App). */
export function configureBundler(keyGetter: () => string) { _keyGetter = keyGetter }

/** Enqueue one ASY request; schedules a debounced flush for its model bucket. */
export function enqueueAsyncRequest(req: PendingRequest): void {
  const list = buckets.get(req.modelId) ?? []
  // De-dupe by nodeId — a re-run replaces the node's pending request.
  const next = list.filter(r => r.nodeId !== req.nodeId)
  next.push(req)
  buckets.set(req.modelId, next)
  const existing = timers.get(req.modelId)
  if (existing) clearTimeout(existing)
  timers.set(req.modelId, setTimeout(() => void flushModel(req.modelId), DEBOUNCE_MS))
}

/** Flush one model bucket now: chunk → submit → addJob per chunk. */
export async function flushModel(modelId: string): Promise<void> {
  const list = buckets.get(modelId) ?? []
  buckets.delete(modelId)
  const t = timers.get(modelId); if (t) clearTimeout(t); timers.delete(modelId)
  if (list.length === 0) return
  const projectId = useCanvasStore.getState().activeProjectId ?? 'unknown'
  const apiKey = _keyGetter()
  const chunks = chunkBySize(list.map(r => ({ key: r.key, bytes: r.bytes }))) as { key: string }[][]
  for (let ci = 0; ci < chunks.length; ci++) {
    const reqs = chunks[ci].map(c => list.find(r => r.key === c.key)!)
    try {
      const opName = await submitGeminiBatch(modelId, reqs.map(r => ({ body: r.body, key: r.key })), apiKey)
      useAsyncJobStore.getState().addJob({
        id: opName, projectId, provider: 'gemini', modelId, opName,
        status: 'submitted', submittedAt: performance.now(),
        requests: reqs.map(r => ({ nodeId: r.nodeId, key: r.key })),
      })
    } catch (e) {
      // Surface submit failure on each node in the chunk (consumer reads job; none created → node times out).
      console.warn('[AYCB] async bundle submit failed:', e)
    }
  }
}

/** Manual "Run queue now" — flush every model bucket. */
export async function flushAll(): Promise<void> {
  await Promise.all([...buckets.keys()].map(m => flushModel(m)))
}
```

Note: `submittedAt` uses `performance.now()` (monotonic, allowed) rather than `Date.now()`.

- [ ] **Step 4: Run tests, verify pass**

Run: `cd frontend && npx vitest run src/services/asyncBundler.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/asyncBundler.ts frontend/src/services/asyncBundler.test.ts
git commit -m "[feat] asyncBundler: per-model debounced bundling + 20MB chunking"
```

---

## Task 6: Wire `useGenerateImage` async path (enqueue + consume)

**Files:**
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts`

- [ ] **Step 1: Enqueue instead of inline-await in the async branch**

In `runSingle`, the request body for the bundler is the same `body` the provider
builds. Rather than duplicate body-building, gate the async path at the provider
boundary: in the async branch, build the minimal Gemini request body the batch
path expects (mirror `geminiProvider.generateImage`'s `body`), then enqueue.

Add near the top of the file:

```ts
import { enqueueAsyncRequest } from '../../services/asyncBundler'
import { useAsyncJobStore } from '../../stores/asyncJobStore'
import { applyImageResult } from '../../services/applyImageResult'
import { estimateTextTokens } from '../../utils/costEstimate'
```

In `runSingle`, immediately after computing `asyncCapableRun` and `imageOptions`,
short-circuit when async is active for Gemini:

```ts
    if (asyncGenRef.current && asyncCapableRun && modelInfo.provider === 'gemini') {
      // Build the same GenerateContentRequest body the sync REST path builds.
      const body = await api.buildGeminiImageBody(prompt, selectedModel, sentRefs, imageOptions)
      const bytes = JSON.stringify(body).length
      enqueueAsyncRequest({ nodeId: id, key: id, body, bytes, modelId: selectedModel })
      updateNodeData(id, { asyncPending: true })
      return            // non-blocking — poller + effect finish the job
    }
```

If `api.buildGeminiImageBody` does not exist, add an exported builder in
`providers/geminiProvider.ts` factored out of `generateImage` (the code that
assembles `body` before the `options.async` branch at line ~122), and expose it
through `api`. This is a small, in-scope refactor that removes duplication.

- [ ] **Step 2: Add the consumer effect**

After the existing effects in `useGenerateImage`, add an effect that watches this
node's request inside any job and renders the result once:

```ts
  const myJob = useAsyncJobStore(s => s.jobs.find(j => j.requests.some(r => r.nodeId === id)))
  useEffect(() => {
    if (!myJob) return
    const req = myJob.requests.find(r => r.nodeId === id)
    if (!req) return
    if (req.error) {
      setError(req.error)
      updateNodeData(id, { asyncPending: false })
      useAsyncJobStore.getState().markConsumed(myJob.id, req.key)
      return
    }
    if (!req.resultMediaId) return     // still polling
    const mediaId = req.resultMediaId
    const currentIds = (getNodes().find(n => n.id === id)?.data as Record<string, unknown>)?.historyIds as string[] ?? historyIds
    const newHistory = [...currentIds, mediaId].slice(-MAX_HISTORY)
    updateNodeData(id, { mediaId, historyIds: newHistory, outputMediaIds: null, asyncPending: false })
    setHistoryIds(newHistory)
    // Cost — discounted value already applied server-side parse; estimate fallback ×0.5.
    const est = estimateCost(selectedModel, 'generate_image', activePrompt, 0, 0, 1, resolutionRef.current, false)
    useCanvasStore.getState().addCost({
      timestamp: new Date().toISOString(), nodeId: id, nodeName: 'Generate Image',
      model: selectedModel, inputTokens: est.inputTokens, outputTokens: 0,
      costUsd: est.costUsd * 0.5,
    })
    useAsyncJobStore.getState().markConsumed(myJob.id, req.key)
    if (myJob.requests.length <= 1) useAsyncJobStore.getState().removeJob(myJob.id)
  }, [myJob, id])   // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Show the queued state**

Where the node renders its loading/status label, add: when
`data.asyncPending` is true, show `Batch · queued`. (Find the existing status
label in `GenerateImageNode.tsx` and add the branch; the elapsed timer already
exists for `loading && asyncGen` — reuse it keyed on `asyncPending`.)

- [ ] **Step 4: Run the generate-image tests + tsc**

Run: `cd frontend && npx vitest run src/nodes/generate-image && npx tsc --noEmit`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/nodes/generate-image/useGenerateImage.ts frontend/src/nodes/generate-image/GenerateImageNode.tsx frontend/src/providers/geminiProvider.ts frontend/src/api.ts
git commit -m "[feat] GenerateImage: non-blocking ASY enqueue + async result consumer"
```

---

## Task 7: Start poller on mount + global queue UI

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/console/ConsolePanel.tsx` (or a small header chip)

- [ ] **Step 1: Start the poller + configure the bundler key on mount**

In `App.tsx`, inside the top-level component, add:

```ts
import { startAsyncJobPoller } from './services/asyncJobPoller'
import { configureBundler } from './services/asyncBundler'
// ... inside component, with access to the settings/api-key hook:
useEffect(() => {
  const getKey = () => /* the resolved Gemini api key from settings */ ''
  configureBundler(getKey)
  startAsyncJobPoller(/* getKey if you chose the getter form in Task 4 Step 3a */)
}, [])
```

Wire `getKey` to the actual settings source confirmed in Task 4 Step 3a.

- [ ] **Step 2: Global queue counter + manual flush**

Add a small indicator that reads `useAsyncJobStore(s => s.activeJobs().length)`
and, when > 0, shows `N batch in corso` with a "Lancia coda ora" button calling
`flushAll()` from `asyncBundler`. Place it in the Console panel header row
(reuse existing styles). Keep additions under the file's line budget.

- [ ] **Step 3: Verify build + full tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: PASS, 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/console/ConsolePanel.tsx
git commit -m "[feat] start async poller on mount + queue counter UI"
```

---

## Task 8: Live N=3 routing smoke gate

**Files:**
- Create: `scripts/smoke_test_gemini_batch_bundle.py`

> Per memory `feedback_verify_empirically` + `reference_cli_generation_skill`,
> read `skills/aycb-cli-generation/SKILL.md` before writing this script.

- [ ] **Step 1: Write the smoke script**

Submit ONE batch with 3 distinct prompts and metadata keys `n0/n1/n2`, poll to
terminal, assert `op.response.inlinedResponses.inlinedResponses` has 3 entries
and each carries its `metadata.key` back, with image bytes present. Print a
PASS/FAIL line per key. Use the same REST shape as `submitGeminiBatch`.

- [ ] **Step 2: Run it against the live API**

Run: `python scripts/smoke_test_gemini_batch_bundle.py`
Expected: 3/3 keys routed, images non-empty. If keys do NOT round-trip,
STOP — do not enable bundling routing; fall back to one-request-per-job
(`requests[]` length 1) until the API shape is confirmed.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke_test_gemini_batch_bundle.py
git commit -m "[test] live smoke gate for N>1 batch bundle routing"
```

---

## Self-Review Notes

- **Spec coverage:** submit/poll split (T1), job store + recovery persistence
  (T2), shared applier (T3), background parallel poller + recovery (T4),
  per-model bundling + 20MB chunking (T5), non-blocking enqueue + consumer +
  discounted cost (T6), poller start + queue UI (T7), N>1 smoke gate (T8). All
  spec sections mapped.
- **Open wiring confirmed in-task, not assumed:** API-key source (T4 S3a),
  Gemini body builder reuse (T6 S1), status-label location (T6 S3).
- **No `Date.now()`/`Math.random()`** in new modules — `submittedAt` uses
  `performance.now()`; batch `display_name` dropped its timestamp.
- **Cost −50%:** applied both server-side (`parseGenerateContentResponse` ×
  `GEMINI_BATCH_DISCOUNT`) and in the node's estimate fallback (`× 0.5`).
- **Type consistency:** `AsyncJob`/`AsyncJobRequest`/`PendingRequest` names and
  fields are reused verbatim across T2/T4/T5/T6.
```
