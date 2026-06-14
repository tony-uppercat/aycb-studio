# Async Batch Queue + Bundling — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Builds on:** [2026-06-11-async-imagegen-toggle-design.md](./2026-06-11-async-imagegen-toggle-design.md) (ASY toggle, Batch API −50%)

---

## 1. Problem

Today the ASY toggle (`asyncGen`) routes a GenerateImage run through the Gemini/OpenAI
Batch API at −50% cost. But the batch is **blocking**:

- `useGenerateImage.run()` submits **and polls inline** until the job finishes
  (`runGeminiBatch` in `geminiBatchPath.ts` — submit → poll every 10s → decode).
  The node sits `loading` for the whole multi-minute window.
- The cascade engine serializes runs with a global lock (`_cascadeRunning` in
  `cascadeRun.ts`). A second "Run Selected" waits for the first batch to fully
  finish — you can launch **one async group at a time**.
- Each ASY run submits **one** batch job, even though the Gemini
  `:batchGenerateContent` envelope already accepts a **list** of requests
  (`input_config.requests.requests[]`, today length 1).

Result: you cannot fire several async groups and keep working, and you pay
submit/poll overhead per single image instead of bundling.

## 2. Goals

- Fire an ASY group → **submit returns immediately**, node does not block. Keep
  working on the canvas.
- Launch **multiple** async groups; all poll concurrently in the background.
- **Bundle** multiple requests for the same model into **one** batch submission
  (`requests[]` length N), keeping the −50% discount, cutting HTTP/poll overhead
  and avoiding per-account concurrent-job limits.
- **Recovery:** persist in-flight operation names; on reload, resume polling and
  recover results (no lost generations).
- Log the cost **already discounted −50%** per node (closes the audit's
  batch-discount gap).

## 3. Non-Goals

- Speeding up an individual batch job. Batch turnaround is Google's; −50% **is**
  the price of slowness. Bundling wins on the SET (one window for N), not on the
  single item.
- Async for non-ASY / sync runs, video, or LLM. Scope is **ASY image generation
  only** (Gemini + OpenAI batch-capable models).
- Cancel UI (deferred to a later pass).

## 4. The −50% / latency truth (recorded so we don't re-litigate)

The Batch API is half price **because** it has no latency guarantee. You cannot
get "fast AND −50%". The queue does NOT accelerate a job. Its only time benefit
is throughput: N requests in one batch process in parallel server-side, so the
whole set finishes in ≈ one batch window instead of being gated by a client lock.

## 5. Architecture

Split the batch lifecycle into **submit** (fast) and **poll** (background), and
introduce a global job store + a single poller service.

```
ASY Run → run upstream (sync) → enqueue request into bundle bucket (by modelId)
                                          │  (debounce / size cap / manual flush)
                                          ▼
                              submitBundle → 1 opName → addJob(submitted)  → RETURN
                                          │
   asyncJobPoller (singleton, every 10s, jobs polled in PARALLEL)
                                          ▼
                        poll opName → done → map inlinedResponses[] by metadata.key
                                          ▼
              save each image to mediaStore (IndexedDB) → job.results[key]=mediaId, status=done
                                          ▼
   node useEffect watches its job → writes output slot + history + cost(×0.5) → status=consumed
```

## 6. Components (all new files; no bloat of existing ones)

### 6.1 `stores/asyncJobStore.ts` (zustand, persisted)
Job record (one per **bundle**):
```ts
interface AsyncJobRequest { nodeId: string; key: string; resultMediaId?: string; error?: string }
interface AsyncJob {
  id: string
  projectId: string
  provider: 'gemini' | 'openai'
  modelId: string
  opName: string                 // Google/OpenAI operation handle
  status: 'submitted' | 'polling' | 'done' | 'failed'
  submittedAt: number            // ms; per-job clock (NOT relative to first)
  requests: AsyncJobRequest[]    // one entry per bundled node, keyed by metadata.key
  error?: string                 // job-level failure
}
```
Actions: `addJob`, `updateJob`, `setRequestResult(jobId,key,mediaId|error)`,
`markConsumed(jobId,key)`, `removeJob`, `jobsForProject(projectId)`,
`activeJobs()` (status submitted|polling).
Persist slice: active jobs only — **opName, requests metadata, modelId,
provider, projectId, submittedAt**. **Never base64** (bytes live in mediaStore).

### 6.2 `services/asyncBundler.ts`
Accumulates pending ASY requests into buckets keyed by `modelId` (endpoint is
per-model). Flush triggers:
1. **Debounce** — ~2.5s after the last add to the bucket.
2. **Size cap** — estimated payload near the **20MB** inline limit (refs are
   inline base64). Estimate from request body length.
3. **Count cap** — safety ceiling (e.g. 50 requests/bundle).
4. **Manual** — "Lancia coda ora" button flushes all buckets.
On flush: split the bucket into chunks ≤20MB, build one `requests[]` per chunk
with `metadata.key = nodeId` (suffix on collision), call `submitBundle`,
`addJob` per chunk.

### 6.3 `providers/geminiBatchPath.ts` + `openaiBatchPath.ts` — split
- `submitGeminiBatch(modelId, requests: {body,key}[], apiKey) → opName`
  (build `input_config.requests.requests[]` with N entries).
- `pollGeminiBatch(opName, apiKey) → { done, op? }` (one tick).
- `extractAllInlineEntries(op) → Map<key, entry>` (generalize the current
  `extractInlineEntry` which returns only `[0]`).
- Keep `runGeminiBatch` as a thin `submit + poll-loop + extract[0]` wrapper for
  any remaining single-shot caller (back-compat).
- `GEMINI_BATCH_DISCOUNT = 0.5` reused; per-entry parse applies the multiplier.

### 6.4 `services/asyncJobPoller.ts` (singleton)
`startPoller()` called once on app mount (e.g. in `useActiveProject` init or a
top-level hook). Loop: read `activeJobs()`, poll each `opName` **in parallel**
(`Promise.all`), 10s cadence. On `done`: `extractAllInlineEntries`, for each
entry save image to **mediaStore** → `setRequestResult(jobId,key,mediaId)`;
when all requests resolved → `status='done'`. On poll error: backoff retry; after
N tries → `status='failed'` + message (job kept for manual retry). On app mount,
the same loop naturally **recovers** persisted jobs.

### 6.5 `useGenerateImage.ts` — async path change
- ASY run: after upstream, build the request body, hand it to `asyncBundler`
  (`enqueueAsyncRequest`), **return immediately** (no inline poll).
- A `useEffect` subscribes to this node's request inside its job (by nodeId):
  - status `submitted|polling` → node shows "Batch · queued / Xm Ys"
    (elapsed = `now − job.submittedAt`).
  - request `resultMediaId` set → write output slot + push LLM/gen history +
    `addCost` with the **discounted** value; `markConsumed`.
  - request `error` → show node error.
- If the node is unmounted/deleted when the result lands, the mediaId stays in
  the job; the node consumes it on next mount. A job whose nodes are all gone is
  swept.

### 6.6 UI
- Node badge: `Batch · queued` → `Batch · 2m 10s` → result.
- Global queue indicator: small header/console counter "N batch in corso" +
  optional "Lancia coda ora" (manual flush). Reuse Console panel real estate.

## 7. Data flow — bundling + routing

1. User toggles ASY on several GenerateImage nodes (same model) and Runs them
   (individually or via Run Selected).
2. Each enqueues its request into the `modelId` bucket. Debounce collects them.
3. Flush → chunk by 20MB → `submitGeminiBatch(requests[])` → one `opName` per
   chunk → `addJob`.
4. Poller polls each job. On done, `extractAllInlineEntries` returns
   `Map<nodeId, entry>`; each image → mediaStore → `setRequestResult`.
5. Each node's effect picks up its own `resultMediaId` and renders + logs cost.

## 8. Cost (−50%)

`parseGenerateContentResponse(entry.response, modelId, GEMINI_BATCH_DISCOUNT)`
already halves the parsed usage. The node logs `addCost` with that value, so the
cost tab shows the discounted batch cost — fixing the audit gap. Combine with the
resolution-aware cost follow-up so 4K batch is both resolution-correct **and**
−50%.

## 9. Error handling

| Failure | Behavior |
|---|---|
| Submit fails | No job created; node shows error (as today). |
| Poll transient (network/5xx) | Backoff retry inside poller; job stays `polling`. |
| Job terminal-failed (Google) | `status='failed'` + message; job kept for manual retry; affected nodes show error. |
| One entry errors, others ok | Per-entry `error`; only that node shows error, siblings render. |
| Tab closed mid-poll | Job persisted; poller resumes on reload (recovery). |
| Node deleted before result | Result kept in mediaStore via mediaId; orphan job swept. |
| Payload > 20MB | Bundler chunks into multiple jobs before submit. |

## 10. Risks / open verification

- **N>1 inlinedResponses mapping** is verified live only for N=1
  (`scripts/smoke_test_gemini_batch_inline.py`, 2026-06-11). **Gate:** extend the
  smoke test to N=3 with distinct `metadata.key`s and confirm each entry carries
  its key back, BEFORE shipping the routing (memory: `feedback_verify_empirically`).
- 20MB cap is per-submission; size estimate must be conservative.
- OpenAI batch path shape differs from Gemini; v1 may land Gemini bundling first,
  OpenAI as single-request jobs until its list format is verified.
- Poller must self-exclude from the network logger to avoid feedback noise.

## 11. Testing

- `asyncJobStore.test.ts` — add/update/setRequestResult/markConsumed/persist
  slice (no base64)/jobsForProject.
- `asyncBundler.test.ts` — bucket by model, debounce flush, 20MB chunking, count
  cap, manual flush, metadata.key assignment + collision suffix.
- `asyncJobPoller.test.ts` — poll done (fetch mock), per-entry routing, transient
  retry/backoff, terminal fail, recovery from persisted jobs.
- `geminiBatchPath` split tests — `submitGeminiBatch` body shape (requests[]),
  `extractAllInlineEntries` N>1 map.
- Smoke script `scripts/smoke_test_gemini_batch_bundle.py` — live N=3 routing
  gate.

## 12. Build order

1. Split `geminiBatchPath.ts` (submit/poll/extractAll) + tests. Keep `runGeminiBatch` wrapper.
2. `asyncJobStore.ts` + tests.
3. `asyncJobPoller.ts` + tests; start on app mount; recovery.
4. `asyncBundler.ts` + tests (debounce/chunk/manual).
5. Wire `useGenerateImage.ts` async path → enqueue + return + effect consumer + discounted cost.
6. UI: node badge + global counter + manual flush.
7. Smoke-test N=3 gate, then enable bundling routing.
