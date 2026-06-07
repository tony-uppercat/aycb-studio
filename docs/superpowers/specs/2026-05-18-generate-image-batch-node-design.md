# Generate Image Batch Node — Async via Gemini Batch API

**Date:** 2026-05-18
**Status:** Design — awaiting implementation
**Author:** Antonio + Claude (Opus 4.7)

## Summary

Add a new node `Generate Image Batch` that submits image generations via the
Gemini Batch API for a 50% cost discount, with SLA up to 24h. Jobs run
asynchronously in the background and survive browser refresh + backend restart
via a persistent JSON state file. The existing `Generate Image` node remains
untouched.

## Motivation

The CLI script `scripts/batch_brush_refsheet_async.py` already uses the Gemini
Batch API (50% off, JSONL submission, polling, crash recovery via local JSON
file). This design lifts that pattern into the canvas as a first-class node, so
users can run batched image generations from any workflow without dropping to
the CLI.

The existing `Generate Image` node is already dense (GND, THK, CROP, EDIT,
LOCK, x1/x2/x4 batch, swap, history). Cramming async/batch UX into it would
create chaos — a dedicated node keeps both flows clean.

## Scope

### In scope (v1)

- New node `Generate Image Batch` in `frontend/src/nodes/generate-image-batch/`
- Models: `gemini-3-pro-image-preview`, `gemini-3.1-flash-image-preview`,
  `gemini-3.1-flash-lite-image-preview`
- Auto-bundle: requests accumulate in a pending queue; auto-submit when count
  reaches N or idle time reaches T seconds (defaults 5 and 30s, both editable
  from the node)
- Persistent job state via `shared/data/batch-jobs.json`
- Backend poller running as an asyncio task in the FastAPI lifespan
- Recovery: on backend startup, re-poll all `running` jobs; on frontend mount,
  re-hydrate node state from `/api/batch/jobs`
- Per-job cancel
- Results written to `shared/Media/` via the existing bridge (auto-indexed by
  Review Hub scanner) and emitted on the node's `image-out` output one by one
  as they complete

### Deferred to v1.1

- `gpt-image-2` via OpenAI Batch API (needs empirical verification that
  `/v1/images/generations` is supported by the Batch endpoint — historically it
  wasn't). If unsupported, ASYNC for GPT Image 2 stays hidden.

### Out of scope

- A global "Batch Jobs" Console panel (Approach B). Can be added later if
  oversight across many nodes becomes necessary.
- DB-backed storage (Approach C). JSON file matches the proven CLI pattern and
  the expected volume (a handful of jobs/day).
- Video models. Batch API for video is a separate concern.
- Retry-on-failure logic. v1 surfaces the error; user decides next step.

## Architecture

```
Generate Image Batch node (frontend, React)
    │
    ├─ POST /api/batch/submit       (per auto-submit trigger)
    ├─ GET  /api/batch/jobs         (poll every 10s + on mount)
    └─ DELETE /api/batch/jobs/{id}  (cancel)
    ▼
src/plugins/batch_gen.py  ←  auto-discovered FastAPI router
    │
    ├─ uses → src/services/batch_gen_store.py    (atomic JSON r/w)
    ├─ uses → src/services/batch_gen_provider.py (Google genai.batches client)
    └─ background → src/services/batch_gen_poller.py (asyncio task, 10s loop)
    ▼
shared/data/batch-jobs.json   (single source of truth)
shared/Media/{generated images}   (results, with PNG tEXt metadata)
```

### Data shape (`batch-jobs.json`)

```json
{
  "jobs": [
    {
      "id": "uuid4",
      "google_job_name": "batches/abc123",
      "node_id": "node-42",
      "model": "gemini-3-pro-image-preview",
      "submitted_at": "2026-05-18T10:23:00Z",
      "updated_at": "2026-05-18T10:25:00Z",
      "state": "running",
      "requests": [
        {
          "key": "req-0",
          "prompt": "...",
          "refs": ["base64..."],
          "aspect_ratio": "16:9",
          "resolution": "2K",
          "thinking": false,
          "grounding": false
        }
      ],
      "results": [
        {
          "request_key": "req-0",
          "media_id": "...",
          "media_path": "shared/Media/2026-05-18_103000_batch_req-0.png",
          "cost": 0.038
        }
      ],
      "cost_estimate": 0.19,
      "error": null
    }
  ]
}
```

States: `running` | `succeeded` | `failed` | `cancelled` | `expired`.

Atomic write: serialize to `batch-jobs.json.tmp` then `os.replace()` (POSIX
atomic rename guarantee — equivalent on Win32 since file is not open).

### Backend endpoints

| Method | Path                       | Body / params                                  | Response                                  |
|--------|----------------------------|------------------------------------------------|-------------------------------------------|
| POST   | `/api/batch/submit`        | `{ node_id, model, requests[] }`               | `{ job_id, state, count, cost_estimate }` |
| GET    | `/api/batch/jobs`          | `?node_id=X` (optional filter)                 | `{ jobs: [...] }`                         |
| DELETE | `/api/batch/jobs/{job_id}` | —                                              | `{ state }` (final, may be `cancelled` or actual terminal state if race) |

All error responses use HTTP **422** for upstream Google failures, never 502
(memo `feedback_502_masks_errors`).

### Per-request snapshot

When the user clicks "Add to bundle", the frontend snapshots:
`{prompt, refs (base64), model, aspect_ratio, resolution, thinking?, grounding?}`.
Subsequent edits to the node settings do not retroactively affect already-added
requests.

### Auto-submit trigger

Frontend state machine in `useGenerateImageBatch.ts`:

- `pending: Request[]` — local queue
- `bundleN: number` (default 5, editable)
- `bundleT: number` seconds (default 30, editable)
- Idle timer: `setTimeout(submitBundle, bundleT * 1000)` reset on each `add()`
- On `pending.length >= bundleN` → submit immediately
- Manual "Submit now" button always available

### Recovery

- **Backend startup (lifespan):** load `batch-jobs.json`, for each job with
  `state == "running"` spawn a poll cycle so we don't lose stuck jobs.
- **Frontend mount:** `GET /api/batch/jobs?node_id={current}` to hydrate the
  pending/active/result lists for nodes that already submitted before refresh.
  Pending (not-yet-submitted) is local-only and lost on refresh — acceptable
  because pending hasn't paid the API call yet.

## Components

### New backend files

- `src/plugins/batch_gen.py` — FastAPI router (auto-discovered)
- `src/services/batch_gen_store.py` — JSON store r/w + atomic write + corrupt
  recovery (backup to `.corrupt`, reset to `{"jobs": []}`)
- `src/services/batch_gen_poller.py` — asyncio task, 10s loop, calls provider
- `src/services/batch_gen_provider.py` — wraps `google.genai.Client().batches`:
  `create()`, `get()`, `cancel()`, result download + image bytes + cost compute
- `tests/test_batch_gen_store.py`
- `tests/test_batch_gen_routes.py`
- `tests/test_batch_gen_poller.py`

### New frontend files

- `frontend/src/nodes/generate-image-batch/node.manifest.ts`
- `frontend/src/nodes/generate-image-batch/GenerateImageBatchNode.tsx`
- `frontend/src/nodes/generate-image-batch/useGenerateImageBatch.ts`
- `frontend/src/nodes/generate-image-batch/generate-image-batch.test.ts`

### Modified files (minimal)

- `src/api.py` — spawn `batch_gen_poller.start()` in the existing lifespan
  context manager (1 import + ~3 lines)
- `frontend/src/types.ts` — add `GenerateImageBatchNodeData` interface

### Untouched

- `frontend/src/nodes/generate-image/` — existing node is not modified
- `src/review_hub/db.py` — no DB schema changes
- All existing plugins, routers, stores

## Data flow

```
T0  user click "Add to bundle"
    └─ snapshot {prompt, refs[], model, ar, res, thinking?, grounding?} → pending[]
    └─ reset idle timer (bundleT seconds)
T1  threshold met (count >= bundleN OR idle >= bundleT OR manual "Submit now")
    └─ POST /api/batch/submit { node_id, model, requests[] }
    └─ backend: build JSONL → genai.batches.create(...) → write to store
    └─ response: { job_id, state: "running", count, cost_estimate }
    └─ frontend: pending = [], jobs.push(new)
T2  backend poller every 10s
    └─ for each running job → genai.batches.get(name)
    └─ if SUCCEEDED: download result JSONL → for each request:
         - decode inlineData base64 → image bytes
         - write PNG to shared/Media/ with tEXt metadata; cost via
           cost_for_response() (from existing scripts/batch_brush_refsheet.py
           helper, reused — applies the 0.5 BATCH_DISCOUNT multiplier on top
           of MODEL_PRICING entries in src/shared/)
         - append to job.results
    └─ if FAILED / EXPIRED: capture error.message, set state, log via _log()
    └─ atomic store write
T3  frontend poll: GET /api/batch/jobs?node_id={id}
    ├─ on node mount (recovery)
    ├─ immediately after POST /api/batch/submit response
    └─ every 10s WHILE at least one job is in state "running" (paused
       otherwise to avoid wasted polling)
    └─ diff new results → emit each on image-out (uses existing genimage
       per-id emission infra)
    └─ update local history (like Generate Image)
T4  user click "Cancel" on a job
    └─ DELETE /api/batch/jobs/{id} → genai.batches.cancel(name)
    └─ state = cancelled, atomic store write
    └─ frontend reflects via next poll (or immediate via response)
```

## Error handling

| Failure | Handling |
|---|---|
| `batch-jobs.json` corrupt at startup | Backup to `batch-jobs.json.corrupt-{ts}`, reset to `{"jobs": []}`, log warning (CLAUDE.md #12) |
| Google API down on submit | HTTP 422 with provider error message; pending queue preserved; user retries (never 502 — `feedback_502_masks_errors`) |
| Job state FAILED | Set `state = "failed"`, store `error.message`, pill renders red with tooltip, no auto-retry |
| Job state EXPIRED (48h SLA) | Set `state = "expired"`, pill grey, Google does not charge expired jobs, user decides retry |
| Backend crash mid-poll | Lifespan startup re-polls all `running` jobs (state machine is idempotent server-side) |
| Cancel race (job completed between user click and server call) | Return 409 with actual terminal state, frontend reconciles |
| Frontend fetch error | `AbortController` in `useEffect` cleanup (CLAUDE.md #6), exponential backoff up to 60s, never blocks UI |
| Backend exception during poll | Always `_log()` — never `except: pass` (CLAUDE.md #12, `feedback_never_except_pass`); single-job failure must not kill the poller loop |
| Refs > 2K / > 5MB on submit | Downscale to ~1536px JPEG before base64 (memo `feedback_downscale_large_refs`) |
| `thinking=true` + `imageSize >= 2K` on Flash | Omit `thinkingConfig` per submit (memo `feedback_gemini_thinking_imagesize`) |

## Testing

### Backend (pytest)

- `test_batch_gen_store.py`
  - Write then read round-trip
  - Atomic write does not corrupt under simulated crash
  - Corrupt file → backup + reset
  - Concurrent writes serialized via asyncio lock
- `test_batch_gen_routes.py`
  - POST `/api/batch/submit` with mocked `genai.batches.create` → returns job_id, persists
  - GET `/api/batch/jobs` returns persisted jobs, filterable by node_id
  - DELETE cancels via mocked `genai.batches.cancel`
  - Submit when Google returns error → 422, not 502
- `test_batch_gen_poller.py`
  - `running → succeeded` writes files to a tmp media dir
  - `running → failed` records error and continues poller loop
  - `running → expired` records expired state
  - Poller survives single-job exception (mock raises on one job, others process)

### Frontend (vitest)

- `generate-image-batch.test.ts`
  - Manifest valid, auto-discovered by nodes/index.ts
  - `add()` enqueues, resets timer
  - Reaching `bundleN` calls submit immediately
  - Idle past `bundleT` calls submit
  - Manual "Submit now" calls submit regardless of count
  - Hydrate on mount: GET response populates `jobs`
  - `AbortController` cleanup on unmount

### Smoke (manual, one-off)

- `scripts/smoke_batch_node.py` — submit one real Gemini Pro 2K request via the
  new endpoint, wait for completion, verify file exists in `shared/Media/` with
  correct tEXt metadata and ~half the standard cost (memo
  `feedback_verify_empirically`).

## UI sketch (Generate Image Batch node)

```
┌─ Generate Image Batch ──────────────────────[★]┐
│ [model dropdown — Gemini Pro/Flash/Flash-Lite] │
│ [AR ▾] [Res ▾] [🔒] [×]                         │
│ Bundle: N=[5] T=[30]s   pending: 3  ETA: 22s   │
│ [Submit now]                                    │
│                                                 │
│ [textarea prompt]                               │
│                                                 │
│ Active jobs:                                    │
│   ● job a1b2 · 4 reqs · running · 12m · [✕]    │
│   ● job c3d4 · 2 reqs · running · 3m  · [✕]    │
│   ● job e5f6 · 5 reqs · failed     · ⓘ          │
│                                                 │
│ [preview area — last completed result]          │
│ [history bar, like Generate Image]              │
└────────────────────────────────────────────────┘
```

No emoji in UI text — Lucide icons (CLAUDE.md #5). The bullets above are
placeholder for design phase; final renders use `circle` Lucide variants.

## File-count check (CLAUDE.md #1: max 300 lines / file)

Estimated line counts:

- `batch_gen.py` (router): ~150
- `batch_gen_store.py`: ~120
- `batch_gen_poller.py`: ~180
- `batch_gen_provider.py`: ~200
- `GenerateImageBatchNode.tsx`: ~200
- `useGenerateImageBatch.ts`: ~220

All within the 300-line cap with the 250-line planning headroom.

## Open questions

1. Should `gpt-image-2` ASYNC be visible-but-disabled with "v1.1" tooltip, or
   fully hidden until v1.1 ships? Recommend **hidden** to avoid clutter.
2. Should the "preview area" show a thumbnail grid of the latest job's results,
   or only the single most recent image? Recommend **single most recent**, with
   the rest accessible via the history bar (matches Generate Image).
3. Cost label color (`priceTier`): batch cost is half — should we still tier on
   the original price, or on the discounted price? Recommend **discounted**,
   since that's the actual user cost.

These are non-blocking and can be resolved during implementation.

## Acceptance criteria

- New node appears in canvas right-click menu under category `media-model`.
- Submitting 5 requests in a row triggers exactly one batch job (one
  `genai.batches.create` call).
- Submitting 1 request and waiting 30s triggers exactly one batch job.
- Job survives full process restart: kill backend mid-poll, restart, job
  resumes polling and eventually completes.
- Job survives full browser refresh: refresh during a 12h queued job, on mount
  the active jobs reappear.
- Results land in `shared/Media/` with PNG tEXt metadata (prompt, model,
  discounted cost) and appear in Review Hub gallery.
- Cancel works mid-flight; cost recorded as 0 if cancelled before completion.
- All new pytest + vitest tests pass.
- Existing `Generate Image` node behavior is unchanged (regression check).
