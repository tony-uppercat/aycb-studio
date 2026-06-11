# Async Image Generation Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-node "ASY" toggle on Generate Image that routes Gemini/OpenAI generation through their Batch APIs at 50% cost, awaiting the result so cascades stay correct.

**Architecture:** Two new pure client-side modules (`geminiBatchPath.ts`, `openaiBatchPath.ts`) implement submit → poll → decode and return the same `GenerateImageResult` the sync paths return. The existing providers branch to them when `options.async` is set. Shared Gemini parse/cost logic moves to a new `geminiShared.ts` (also brings `geminiProvider.ts` back under the 300-line rule). Node UI is a single toggle button; state lives in node data (`asyncGen`).

**Tech Stack:** React 19 + TS 5.9, vitest (mocked `fetch`), Gemini Batch API (REST inline mode), OpenAI Batch API (JSONL file mode).

**Spec:** `docs/superpowers/specs/2026-06-11-async-imagegen-toggle-design.md`

---

### Task 0: Smoke-test Gemini inline batch REST shape (empirical, ~$0.02)

The exact JSON nesting of the inline batch result is unverified (SDK docs only).
Memory `feedback_verify_empirically` mandates a live check before coding the parser.

**Files:**
- Create: `scripts/smoke_test_gemini_batch_inline.py`

- [ ] **Step 0.1: Write the smoke script** (read `skills/aycb-cli-generation/SKILL.md` first)

```python
"""Smoke test: Gemini Batch API INLINE mode via raw REST.

Submits ONE cheap flash-lite image request inline, polls every 10s,
then prints the COMPLETE operation JSON (b64 truncated) so the exact
result nesting can be coded into frontend/src/providers/geminiBatchPath.ts.
Cost: ~$0.02 (flash-lite @1K, batch -50%).
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import settings

BASE = "https://generativelanguage.googleapis.com/v1beta"
MODEL = "gemini-3.1-flash-lite-image-preview"
TERMINAL = {"BATCH_STATE_SUCCEEDED", "BATCH_STATE_FAILED",
            "BATCH_STATE_CANCELLED", "BATCH_STATE_EXPIRED"}


def _call(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "x-goog-api-key": settings.gemini_api_key,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _truncate_b64(obj):
    if isinstance(obj, dict):
        return {k: ("<b64 %d chars>" % len(v) if k == "data" and isinstance(v, str) and len(v) > 200
                    else _truncate_b64(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_truncate_b64(x) for x in obj]
    return obj


def main() -> int:
    submit_body = {
        "batch": {
            "display_name": "aycb-smoke-inline",
            "input_config": {"requests": {"requests": [{
                "request": {
                    "contents": [{"role": "user", "parts": [{"text": "A red cube on a white table, studio light"}]}],
                    "generationConfig": {
                        "responseModalities": ["IMAGE", "TEXT"],
                        "imageConfig": {"imageSize": "1K", "aspectRatio": "1:1"},
                    },
                },
                "metadata": {"key": "r0"},
            }]}},
        }
    }
    op = _call("POST", f"{BASE}/models/{MODEL}:batchGenerateContent", submit_body)
    print("=== SUBMIT RESPONSE ===")
    print(json.dumps(_truncate_b64(op), indent=2))
    name = op["name"]

    while True:
        time.sleep(10)
        op = _call("GET", f"{BASE}/{name}")
        state = (op.get("metadata") or {}).get("state", "?")
        print(f"poll: state={state} done={op.get('done')}")
        if state in TERMINAL or op.get("done"):
            break

    print("=== FINAL OPERATION ===")
    print(json.dumps(_truncate_b64(op), indent=2))
    out = Path(__file__).parent / "smoke_batch_inline_result.json"
    out.write_text(json.dumps(op, indent=2), encoding="utf-8", newline="\n")
    print(f"full JSON (with b64) -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 0.2: Run it**

Run: `python scripts/smoke_test_gemini_batch_inline.py`
Expected: state transitions to `BATCH_STATE_SUCCEEDED` (usually < a few min for 1 request); final JSON printed. Record the exact path to the inlined response (candidates/parts/inlineData) and the usageMetadata location.

- [ ] **Step 0.3: Adjust Task 1 parser constants if the real shape differs from the defensive parser below, then delete `scripts/smoke_batch_inline_result.json` (contains b64) and commit the script**

```bash
git add scripts/smoke_test_gemini_batch_inline.py
git commit -m "[test] Smoke: Gemini Batch API inline REST shape"
```

---

### Task 1: Extract `geminiShared.ts` (parse + cost, reused by sync and batch paths)

**Files:**
- Create: `frontend/src/providers/geminiShared.ts`
- Modify: `frontend/src/providers/geminiProvider.ts` (delete moved code, import instead)
- Test: `frontend/src/providers/geminiShared.test.ts`

- [ ] **Step 1.1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { parseGenerateContentResponse, computeGeminiCost } from './geminiShared'

describe('computeGeminiCost', () => {
  it('uses fixed per-image price for image models', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290)).toBeCloseTo(0.067)
  })
  it('applies multiplier (batch discount)', () => {
    expect(computeGeminiCost('gemini-3.1-flash-image-preview', 100, 1290, 0.5)).toBeCloseTo(0.0335)
  })
})

describe('parseGenerateContentResponse', () => {
  const resp = {
    candidates: [{ content: { parts: [{ inlineData: { data: 'AAAA' } }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290 },
  }
  it('extracts image and usage', () => {
    const r = parseGenerateContentResponse(resp, 'gemini-3.1-flash-image-preview', 1)
    expect(r.image_b64).toBe('AAAA')
    expect(r.status).toBe('OK')
    expect(r.usage?.cost_usd).toBeCloseTo(0.067)
  })
  it('handles snake_case REST fields', () => {
    const snake = {
      candidates: [{ content: { parts: [{ inline_data: { data: 'BBBB' } }] } }],
      usage_metadata: { prompt_token_count: 5, candidates_token_count: 100 },
    }
    const r = parseGenerateContentResponse(snake, 'gemini-3.1-flash-image-preview', 0.5)
    expect(r.image_b64).toBe('BBBB')
    expect(r.usage?.cost_usd).toBeCloseTo(0.0335)
  })
  it('returns status when no image part', () => {
    const r = parseGenerateContentResponse({ candidates: [{ content: { parts: [{ text: 'nope' }] } }] }, 'x', 1)
    expect(r.image_b64).toBeNull()
    expect(r.status).toBe('No image generated')
  })
})
```

- [ ] **Step 1.2: Run to verify fail** — `cd frontend && npx vitest run src/providers/geminiShared.test.ts` → FAIL (module not found)

- [ ] **Step 1.3: Implement `geminiShared.ts`** by MOVING from `geminiProvider.ts`: `GEMINI_IMAGE_COST_FALLBACK`, `imageCostFor`, `computeGeminiCost` (add `multiplier = 1` param), plus a new `parseGenerateContentResponse` extracted from the sync path's response-handling block (`geminiProvider.ts:171-195`):

```ts
/**
 * Shared Gemini image-generation helpers — response parsing and cost,
 * used by both the sync REST path (geminiProvider) and the async
 * Batch API path (geminiBatchPath).
 */
import type { GenerateImageResult, UsageInfo } from '../types'
import { MODEL_PRICING } from '../utils/costEstimate'
import { getCachedRegistry } from '../hooks/useModelRegistry'

const GEMINI_IMAGE_COST_FALLBACK: Record<string, number> = {
  'gemini-3.1-flash-image-preview': 0.067,
  'gemini-3-pro-image-preview': 0.134,
}

function imageCostFor(modelId: string): number | null {
  const cached = getCachedRegistry()
  if (cached) {
    const entry = cached.find((m) => m.id === modelId)
    if (entry?.cost_per_call != null) return entry.cost_per_call
  }
  return GEMINI_IMAGE_COST_FALLBACK[modelId] ?? null
}

/** Fixed per-image for image gen, per-token otherwise. `multiplier` = batch discount. */
export function computeGeminiCost(modelId: string, inputTokens: number, outputTokens: number, multiplier = 1): number {
  const perImage = imageCostFor(modelId)
  if (perImage !== null && outputTokens > 0) return perImage * multiplier
  const rates = MODEL_PRICING[modelId] ?? [0, 0]
  return ((inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1]) * multiplier
}

/** GenerateContentResponse JSON (camelCase SDK or snake_case REST) → GenerateImageResult. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseGenerateContentResponse(data: any, modelId: string, costMultiplier = 1): GenerateImageResult {
  const um = data.usageMetadata ?? data.usage_metadata ?? {}
  const inputTokens = um.promptTokenCount ?? um.prompt_token_count ?? 0
  const outputTokens = um.candidatesTokenCount ?? um.candidates_token_count ?? 0
  const usage: UsageInfo | undefined = (inputTokens > 0 || outputTokens > 0)
    ? {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: computeGeminiCost(modelId, inputTokens, outputTokens, costMultiplier),
      }
    : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = data.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data
    if (inline?.data) return { image_b64: inline.data, status: 'OK', usage }
  }
  return { image_b64: null, status: 'No image generated', usage }
}
```

- [ ] **Step 1.4: Update `geminiProvider.ts`** — delete the moved block (lines 60-82) and the inline response-parse block (lines 171-195), import `{ computeGeminiCost, parseGenerateContentResponse }` from `./geminiShared`, replace the end of `geminiImageProvider.generateImage` with:

```ts
    const data = await response.json()
    return parseGenerateContentResponse(data, modelId)
```

  and in `imagenImageProvider` replace `imageCostFor(modelId) ?? 0` with `computeGeminiCost(modelId, 0, 1)` — NO: imagen needs the raw per-image price with outputTokens=0. Keep it simple: also export `imageCostFor` from `geminiShared` and import it in the imagen provider (`const perImageCost = imageCostFor(modelId) ?? 0` unchanged).

- [ ] **Step 1.5: Run tests** — `npx vitest run src/providers/` → new tests PASS, existing `geminiProvider.test.ts` PASS unchanged.

- [ ] **Step 1.6: Commit**

```bash
git add frontend/src/providers/geminiShared.ts frontend/src/providers/geminiShared.test.ts frontend/src/providers/geminiProvider.ts
git commit -m "[refactor] Extract geminiShared (parse + cost) from geminiProvider"
```

---

### Task 2: `geminiBatchPath.ts` — inline Batch API submit/poll/decode

**Files:**
- Create: `frontend/src/providers/geminiBatchPath.ts`
- Test: `frontend/src/providers/geminiBatchPath.test.ts`

- [ ] **Step 2.1: Write failing tests** (mock global fetch; `pollMs: 0` so the loop is instant)

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runGeminiBatch, extractInlineEntry } from './geminiBatchPath'

const SUBMIT_OK = { name: 'batches/abc123', metadata: { state: 'BATCH_STATE_PENDING' } }
const REQUEST_BODY = { contents: [{ role: 'user', parts: [{ text: 'p' }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) }
}

describe('runGeminiBatch', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('submits one inline request and polls to success', async () => {
    const done = {
      name: 'batches/abc123', done: true,
      metadata: { state: 'BATCH_STATE_SUCCEEDED' },
      response: { inlinedResponses: { inlinedResponses: [{ response: {
        candidates: [{ content: { parts: [{ inlineData: { data: 'IMG64' } }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1290 },
      } }] } },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson(SUBMIT_OK))                          // submit
      .mockResolvedValueOnce(okJson({ ...SUBMIT_OK, metadata: { state: 'BATCH_STATE_RUNNING' } }))
      .mockResolvedValueOnce(okJson(done))                               // terminal
    vi.stubGlobal('fetch', fetchMock)

    const r = await runGeminiBatch('gemini-3.1-flash-image-preview', REQUEST_BODY, 'KEY', { pollMs: 0 })
    expect(r.image_b64).toBe('IMG64')
    expect(r.usage?.cost_usd).toBeCloseTo(0.0335)   // 0.067 × 0.5

    // submit body shape
    const submitCall = fetchMock.mock.calls[0]
    expect(submitCall[0]).toContain(':batchGenerateContent')
    const sent = JSON.parse(submitCall[1].body)
    expect(sent.batch.input_config.requests.requests[0].request).toEqual(REQUEST_BODY)
    // poll URL
    expect(fetchMock.mock.calls[1][0]).toContain('/v1beta/batches/abc123')
  })

  it('surfaces a per-request error entry', async () => {
    const failed = {
      done: true, metadata: { state: 'BATCH_STATE_SUCCEEDED' },
      response: { inlinedResponses: { inlinedResponses: [{ error: { message: 'quota exceeded' } }] } },
    }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson(SUBMIT_OK))
      .mockResolvedValueOnce(okJson(failed)))
    const r = await runGeminiBatch('m', REQUEST_BODY, 'KEY', { pollMs: 0 })
    expect(r.image_b64).toBeNull()
    expect(r.status).toContain('quota exceeded')
  })

  it('surfaces a failed job state', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson(SUBMIT_OK))
      .mockResolvedValueOnce(okJson({ done: true, metadata: { state: 'BATCH_STATE_FAILED' }, error: { message: 'boom' } })))
    const r = await runGeminiBatch('m', REQUEST_BODY, 'KEY', { pollMs: 0 })
    expect(r.image_b64).toBeNull()
    expect(r.status).toContain('boom')
  })

  it('throws a clear error on submit HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('{"error":{"message":"bad"}}') }))
    await expect(runGeminiBatch('m', REQUEST_BODY, 'KEY', { pollMs: 0 })).rejects.toThrow(/bad/)
  })
})

describe('extractInlineEntry', () => {
  it('tolerates flat inlinedResponses array (alternate REST nesting)', () => {
    const op = { response: { inlinedResponses: [{ response: { candidates: [] } }] } }
    expect(extractInlineEntry(op)).toEqual({ response: { candidates: [] } })
  })
})
```

- [ ] **Step 2.2: Run to verify fail** — `npx vitest run src/providers/geminiBatchPath.test.ts` → FAIL

- [ ] **Step 2.3: Implement** (align field paths with Task 0's recorded real JSON if different)

```ts
/**
 * Gemini Batch API path — async generation at 50% cost.
 *
 * One INLINE request per run (payload < 20MB cap; refs are inline anyway
 * in the sync path). submit → poll (10s, doc cadence) → decode. Returns
 * the same GenerateImageResult as the sync REST path so the caller
 * (geminiProvider.generateImage) is transparent to the mode.
 *
 * Shapes verified empirically via scripts/smoke_test_gemini_batch_inline.py
 * (memory feedback_verify_empirically).
 */
import type { GenerateImageResult } from '../types'
import { parseGenerateContentResponse } from './geminiShared'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const TERMINAL = new Set([
  'BATCH_STATE_SUCCEEDED', 'BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED',
])
export const GEMINI_BATCH_DISCOUNT = 0.5
const DEFAULT_POLL_MS = 10_000

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function googleError(resp: Response): Promise<string> {
  const txt = await resp.text().catch(() => `HTTP ${resp.status}`)
  try { return JSON.parse(txt).error?.message ?? txt } catch { return txt }
}

/** First inlined entry from a finished operation — tolerates both REST nestings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractInlineEntry(op: any): any | null {
  const inlined = op?.response?.inlinedResponses
  const arr = Array.isArray(inlined) ? inlined : inlined?.inlinedResponses
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null
}

/**
 * Submit one request body (same GenerateContentRequest the sync path builds)
 * as an inline batch, await the result. Cost ×0.5 via parse multiplier.
 */
export async function runGeminiBatch(
  modelId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestBody: Record<string, any>,
  apiKey: string,
  opts?: { pollMs?: number },
): Promise<GenerateImageResult> {
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS
  const headers = { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }

  const submitResp = await fetch(`${BASE}/models/${modelId}:batchGenerateContent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      batch: {
        display_name: `aycb-async-${Date.now().toString(36)}`,
        input_config: { requests: { requests: [{ request: requestBody, metadata: { key: 'r0' } }] } },
      },
    }),
  })
  if (!submitResp.ok) throw new Error(`Gemini batch submit failed: ${await googleError(submitResp)}`)
  const opName = (await submitResp.json()).name as string
  if (!opName) throw new Error('Gemini batch submit returned no operation name')

  // Poll until terminal. Job runs server-side; closing the tab loses the
  // result but not the job (recovery is v2 — see spec).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let op: any
  for (;;) {
    await sleep(pollMs)
    const pollResp = await fetch(`${BASE}/${opName}`, { headers })
    if (!pollResp.ok) throw new Error(`Gemini batch poll failed: ${await googleError(pollResp)}`)
    op = await pollResp.json()
    const state = op.metadata?.state ?? ''
    if (op.done || TERMINAL.has(state)) break
  }

  const state = op.metadata?.state ?? ''
  if (state !== 'BATCH_STATE_SUCCEEDED') {
    const msg = op.error?.message ?? state ?? 'unknown'
    return { image_b64: null, status: `Gemini batch ${msg}`, usage: undefined }
  }
  const entry = extractInlineEntry(op)
  if (!entry) return { image_b64: null, status: 'Gemini batch: empty result', usage: undefined }
  if (entry.error) {
    return { image_b64: null, status: `Gemini batch request error: ${entry.error.message ?? JSON.stringify(entry.error).slice(0, 200)}`, usage: undefined }
  }
  return parseGenerateContentResponse(entry.response, modelId, GEMINI_BATCH_DISCOUNT)
}
```

- [ ] **Step 2.4: Run tests** — `npx vitest run src/providers/geminiBatchPath.test.ts` → PASS

- [ ] **Step 2.5: Wire the branch in `geminiProvider.ts`** — in `geminiImageProvider.generateImage`, right after `body` is fully built (after the grounding block, before the sync `fetch`):

```ts
    // Async mode: same request body via Batch API at 50% cost (awaits result).
    if (options?.async) {
      return runGeminiBatch(modelId, body, apiKey)
    }
```

  with `import { runGeminiBatch } from './geminiBatchPath'` at top.

- [ ] **Step 2.6: Run all provider tests** — `npx vitest run src/providers/` → PASS

- [ ] **Step 2.7: Commit**

```bash
git add frontend/src/providers/geminiBatchPath.ts frontend/src/providers/geminiBatchPath.test.ts frontend/src/providers/geminiProvider.ts
git commit -m "[feat] Gemini async path — inline Batch API at 50% cost"
```

---

### Task 3: `openaiBatchPath.ts` — JSONL Batch API submit/poll/decode

**Files:**
- Create: `frontend/src/providers/openaiBatchPath.ts`
- Modify: `frontend/src/providers/openaiProvider.ts` (export `computeCost`, add branch)
- Test: `frontend/src/providers/openaiBatchPath.test.ts`

- [ ] **Step 3.1: Export `computeCost` from `openaiProvider.ts`** (add `export` keyword on the existing function — no other change)

- [ ] **Step 3.2: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildBatchLine, runOpenAIBatch } from './openaiBatchPath'

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) }
}

describe('buildBatchLine', () => {
  it('wraps body with custom_id/method/url', () => {
    const line = JSON.parse(buildBatchLine('/v1/images/generations', { model: 'gpt-image-2', prompt: 'p' }))
    expect(line).toEqual({
      custom_id: 'r0', method: 'POST', url: '/v1/images/generations',
      body: { model: 'gpt-image-2', prompt: 'p' },
    })
  })
})

describe('runOpenAIBatch', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  const RESULT_LINE = JSON.stringify({
    custom_id: 'r0',
    response: { body: { data: [{ b64_json: 'IMG64' }], usage: { input_tokens: 100, output_tokens: 1000, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } } },
  })

  it('text-to-image: uploads JSONL, creates batch on /generations, polls, decodes at half cost', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))                            // JSONL upload
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'validating' }))      // batches.create
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'in_progress' }))     // poll
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'completed', output_file_id: 'file-out' }))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(RESULT_LINE) }) // download
      .mockResolvedValue(okJson({}))                                               // cleanup deletes
    vi.stubGlobal('fetch', fetchMock)

    const r = await runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'K', size: '1024x1024', quality: 'medium' }, { pollMs: 0 })
    expect(r.image_b64).toBe('IMG64')
    // sync cost would be 100/1M*5 + 1000/1M*30 = 0.0305 → batch half = 0.01525
    expect(r.usage?.cost_usd).toBeCloseTo(0.01525)

    const createCall = fetchMock.mock.calls[1]
    expect(createCall[0]).toContain('/v1/batches')
    const created = JSON.parse(createCall[1].body)
    expect(created.endpoint).toBe('/v1/images/generations')
    expect(created.completion_window).toBe('24h')
  })

  it('with refs: uploads vision files first and targets /edits with file_id objects', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-ref0' }))                          // vision upload
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))                            // JSONL upload
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'validating' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'completed', output_file_id: 'file-out' }))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(RESULT_LINE) })
      .mockResolvedValue(okJson({}))
    vi.stubGlobal('fetch', fetchMock)

    const ref = new File(['x'], 'ref.png', { type: 'image/png' })
    const r = await runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'K', size: 'auto', quality: 'high', refs: [ref] }, { pollMs: 0 })
    expect(r.image_b64).toBe('IMG64')

    const visionForm = fetchMock.mock.calls[0][1].body as FormData
    expect(visionForm.get('purpose')).toBe('vision')
    const created = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(created.endpoint).toBe('/v1/images/edits')
  })

  it('surfaces batch failure with error detail', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'validating' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'failed', errors: { data: [{ message: 'endpoint not supported' }] } }))
      .mockResolvedValue(okJson({})))
    const r = await runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'K', size: 'auto', quality: 'high' }, { pollMs: 0 })
    expect(r.image_b64).toBeNull()
    expect(r.status).toContain('endpoint not supported')
  })

  it('surfaces per-request error line', async () => {
    const errLine = JSON.stringify({ custom_id: 'r0', error: { message: 'content policy' } })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(okJson({ id: 'file-in' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'validating' }))
      .mockResolvedValueOnce(okJson({ id: 'batch-1', status: 'completed', output_file_id: 'file-out' }))
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(errLine) })
      .mockResolvedValue(okJson({})))
    const r = await runOpenAIBatch({ prompt: 'p', modelId: 'gpt-image-2', apiKey: 'K', size: 'auto', quality: 'high' }, { pollMs: 0 })
    expect(r.image_b64).toBeNull()
    expect(r.status).toContain('content policy')
  })
})
```

- [ ] **Step 3.3: Run to verify fail** — `npx vitest run src/providers/openaiBatchPath.test.ts` → FAIL

- [ ] **Step 3.4: Implement**

```ts
/**
 * OpenAI Batch API path for gpt-image — async generation at 50% cost.
 *
 * One request per run: build a single JSONL line, upload it
 * (purpose=batch), create the batch (completion_window 24h), poll to a
 * terminal state, download the output file and decode b64_json. With
 * reference images the endpoint is /v1/images/edits and each ref is
 * uploaded first as a purpose=vision file ({file_id} objects — the only
 * shape batch edits accepts, proven in PAO openai_batch.py). Best-effort
 * file cleanup at the end.
 */
import type { GenerateImageResult, UsageInfo } from '../types'
import { computeCost } from './openaiProvider'

const OPENAI_BASE = 'https://api.openai.com/v1'
const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled'])
export const OPENAI_BATCH_DISCOUNT = 0.5
const DEFAULT_POLL_MS = 10_000

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export function buildBatchLine(url: string, body: Record<string, unknown>): string {
  return JSON.stringify({ custom_id: 'r0', method: 'POST', url, body })
}

async function openaiError(resp: Response): Promise<string> {
  const txt = await resp.text().catch(() => `HTTP ${resp.status}`)
  try { return JSON.parse(txt).error?.message ?? txt } catch { return txt }
}

async function uploadFile(apiKey: string, blob: Blob, filename: string, purpose: string): Promise<string> {
  const fd = new FormData()
  fd.append('purpose', purpose)
  fd.append('file', blob, filename)
  const resp = await fetch(`${OPENAI_BASE}/files`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: fd,
  })
  if (!resp.ok) throw new Error(`OpenAI file upload failed: ${await openaiError(resp)}`)
  return (await resp.json()).id
}

async function deleteFileQuiet(apiKey: string, fileId: string | null | undefined): Promise<void> {
  if (!fileId) return
  try {
    await fetch(`${OPENAI_BASE}/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
  } catch (err) {
    console.warn('[openaiBatch] file cleanup failed:', err)
  }
}

export interface OpenAIBatchParams {
  prompt: string
  modelId: string
  apiKey: string
  size: string
  quality: string
  refs?: File[]
}

export async function runOpenAIBatch(
  params: OpenAIBatchParams,
  opts?: { pollMs?: number },
): Promise<GenerateImageResult> {
  const { prompt, modelId, apiKey, size, quality, refs } = params
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS
  const auth = { 'Authorization': `Bearer ${apiKey}` }
  const refFileIds: string[] = []
  let inputFileId: string | null = null
  let outputFileId: string | null = null

  try {
    // 1. vision uploads when editing with refs
    let url = '/v1/images/generations'
    const body: Record<string, unknown> = { model: modelId, prompt, n: 1, size, quality }
    if (refs && refs.length > 0) {
      url = '/v1/images/edits'
      for (const ref of refs) {
        refFileIds.push(await uploadFile(apiKey, ref, ref.name || 'ref.png', 'vision'))
      }
      body.images = refFileIds.map(id => ({ file_id: id }))
      body.output_format = 'png'
    }

    // 2. JSONL upload + batch create
    const jsonl = new Blob([buildBatchLine(url, body) + '\n'], { type: 'application/jsonl' })
    inputFileId = await uploadFile(apiKey, jsonl, 'aycb-async.jsonl', 'batch')
    const createResp = await fetch(`${OPENAI_BASE}/batches`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_file_id: inputFileId, endpoint: url, completion_window: '24h' }),
    })
    if (!createResp.ok) throw new Error(`OpenAI batch create failed: ${await openaiError(createResp)}`)
    let batch = await createResp.json()

    // 3. poll to terminal
    while (!TERMINAL.has(batch.status)) {
      await sleep(pollMs)
      const pollResp = await fetch(`${OPENAI_BASE}/batches/${batch.id}`, { headers: auth })
      if (!pollResp.ok) throw new Error(`OpenAI batch poll failed: ${await openaiError(pollResp)}`)
      batch = await pollResp.json()
    }
    outputFileId = batch.output_file_id ?? null

    if (batch.status !== 'completed') {
      const detail = batch.errors?.data?.[0]?.message ?? batch.status
      return { image_b64: null, status: `OpenAI batch ${batch.status}: ${detail}`, usage: undefined }
    }
    if (!outputFileId) return { image_b64: null, status: 'OpenAI batch: no output file', usage: undefined }

    // 4. download + decode (single line)
    const dlResp = await fetch(`${OPENAI_BASE}/files/${outputFileId}/content`, { headers: auth })
    if (!dlResp.ok) throw new Error(`OpenAI batch download failed: ${await openaiError(dlResp)}`)
    const line = (await dlResp.text()).split('\n').find(l => l.trim())
    if (!line) return { image_b64: null, status: 'OpenAI batch: empty output', usage: undefined }
    const entry = JSON.parse(line)
    if (entry.error) {
      return { image_b64: null, status: `OpenAI batch request error: ${entry.error.message ?? JSON.stringify(entry.error).slice(0, 200)}`, usage: undefined }
    }
    const respBody = entry.response?.body ?? {}
    const b64 = respBody.data?.[0]?.b64_json ?? null
    const usage: UsageInfo | undefined = respBody.usage
      ? {
          input_tokens: respBody.usage.input_tokens ?? 0,
          output_tokens: respBody.usage.output_tokens ?? 0,
          cost_usd: computeCost(respBody.usage) * OPENAI_BATCH_DISCOUNT,
        }
      : undefined
    return { image_b64: b64, status: b64 ? 'OK' : 'No image generated', usage }
  } finally {
    for (const id of refFileIds) await deleteFileQuiet(apiKey, id)
    await deleteFileQuiet(apiKey, inputFileId)
    await deleteFileQuiet(apiKey, outputFileId)
  }
}
```

- [ ] **Step 3.5: Run tests** — `npx vitest run src/providers/openaiBatchPath.test.ts` → PASS

- [ ] **Step 3.6: Wire the branch in `openaiProvider.ts`** — in `generateImage`, after `size`/`quality` are computed:

```ts
    // Async mode: Batch API at 50% cost (awaits result, can take minutes-hours).
    if (options?.async) {
      return runOpenAIBatch({ prompt, modelId, apiKey, size, quality, refs })
    }
```

  with `import { runOpenAIBatch } from './openaiBatchPath'` at top.

- [ ] **Step 3.7: Run all provider tests** — `npx vitest run src/providers/` → PASS

- [ ] **Step 3.8: Commit**

```bash
git add frontend/src/providers/openaiBatchPath.ts frontend/src/providers/openaiBatchPath.test.ts frontend/src/providers/openaiProvider.ts
git commit -m "[feat] OpenAI gpt-image async path — Batch API at 50% cost"
```

---

### Task 4: `options.async` flag + node toggle UI + discounted estimate

**Files:**
- Modify: `frontend/src/providers/index.ts` (one field on `ImageGenerationOptions`)
- Modify: `frontend/src/nodes/generate-image/useGenerateImage.ts`
- Modify: `frontend/src/nodes/generate-image/GenerateImageNode.tsx`

- [ ] **Step 4.1: Add the option field** in `providers/index.ts`:

```ts
export interface ImageGenerationOptions {
  aspectRatio?: string
  imageSize?: string
  useGrounding?: boolean
  /** When undefined or true, the provider passes thinkingConfig HIGH (Gemini only). */
  thinking?: boolean
  /** Route through the provider's Batch API at 50% cost; awaits the result (Gemini + OpenAI only). */
  async?: boolean
}
```

- [ ] **Step 4.2: Hook state in `useGenerateImage.ts`** — next to the other toggle states (after `cropRefs`, ~line 192):

```ts
  // Async mode: Batch API at 50% cost. run() awaits the result, so cascades
  // stay correct; latency is unbounded (24h SLA, usually minutes).
  const [asyncGen, setAsyncGen, asyncGenRef] = useStateRef(
    Boolean((data as Record<string, unknown>).asyncGen),
  )
```

- [ ] **Step 4.3: Pass the flag in `runSingle`** — extend `imageOptions` (~line 533):

```ts
    const asyncCapable = modelInfo.provider === 'gemini' || modelInfo.provider === 'openai'
    const imageOptions = {
      ...(currentAspectRatio ? { aspectRatio: currentAspectRatio } : {}),
      ...(currentResolution ? { imageSize: currentResolution } : {}),
      ...(groundingRef.current ? { useGrounding: true } : {}),
      ...(thinkingRef.current === false ? { thinking: false } : {}),
      ...(asyncGenRef.current && asyncCapable ? { async: true } : {}),
    }
```

- [ ] **Step 4.4: Discounted estimate** — replace the `estimatedLabel` line (~line 475):

```ts
  const asyncCapableUI = modelInfo.provider === 'gemini' || modelInfo.provider === 'openai'
  const asyncActive = asyncGen && asyncCapableUI
  const estimatedLabel = formatCostEstimate(estimate.costUsd * (asyncActive ? 0.5 : 1))
```

- [ ] **Step 4.5: Elapsed ticker for the waiting status** — near the other small states:

```ts
  // Elapsed seconds while an async (batch) run is in flight — drives the
  // "Batch Xm Ys" status label.
  const [asyncElapsed, setAsyncElapsed] = useState(0)
  useEffect(() => {
    if (!(loading && asyncGen)) { setAsyncElapsed(0); return }
    const t0 = Date.now()
    const iv = setInterval(() => setAsyncElapsed(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => clearInterval(iv)
  }, [loading, asyncGen])
```

- [ ] **Step 4.6: Export from the hook** — add to the return object: `asyncGen, setAsyncGen, asyncCapable: asyncCapableUI, asyncElapsed,`

- [ ] **Step 4.7: Toggle button in `GenerateImageNode.tsx`** — after the EDIT button (line 141), inside the same `batchToggle`-row div:

```tsx
          {h.asyncCapable && (
            <button
              className={`${styles.batchBtn} ${h.asyncGen ? styles.batchBtnActive : ''}`}
              onClick={() => { h.setAsyncGen(!h.asyncGen); h.updateNodeData(id, { asyncGen: !h.asyncGen }) }}
              title={h.asyncGen
                ? 'Async ON — Batch API at 50% cost; run waits for the result (minutes to hours)'
                : 'Async OFF — sync generation at full price'}
            >ASY</button>
          )}
```

- [ ] **Step 4.8: Waiting status in `GenerateImageNode.tsx`** — next to the existing batch progress indicator (line 157):

```tsx
        {h.loading && h.asyncGen && h.asyncCapable && (
          <div className={styles.batchProgress}>
            Batch {Math.floor(h.asyncElapsed / 60)}m {h.asyncElapsed % 60}s
          </div>
        )}
```

- [ ] **Step 4.9: Run full frontend tests + typecheck** — `npx vitest run && npx tsc --noEmit` → PASS

- [ ] **Step 4.10: Commit**

```bash
git add frontend/src/providers/index.ts frontend/src/nodes/generate-image/useGenerateImage.ts frontend/src/nodes/generate-image/GenerateImageNode.tsx
git commit -m "[feat] ASY toggle on Generate Image — async Batch API mode at -50%"
```

---

### Task 5: Full suite + live verification

- [ ] **Step 5.1: Full test run** — `cd frontend && npx vitest run` and `python -m pytest` → all PASS (backend untouched; run anyway per CLAUDE.md rule 8)

- [ ] **Step 5.2: Live Gemini check** — in the app: Generate Image node, flash-lite model, ASY ON, short prompt → expect "Batch Xm Ys" status, then image lands in history with ~half the usual cost in the console Costs tab.

- [ ] **Step 5.3: OpenAI visual check is Antonio's** (key lives only in his browser localStorage — memory project_openai_key_browser_only / feedback_automation_vs_visual_check). Flag it when reporting done.

---

## Self-Review Notes

- Spec coverage: toggle UI (Task 4), Gemini path (Tasks 0-2), OpenAI path (Task 3), discount (Tasks 2-4), estimate -50% (4.4), waiting status (4.5/4.8), tests incl. failure paths (2.1, 3.2), empirical verification (Task 0, 5.2). Recovery/cancel: deferred v2 per spec.
- `types.ts` untouched: `GenerateImageNodeData` has an index signature; `asyncGen` follows the same `(data as Record<string, unknown>)` pattern as `thinking`/`cropRefs`.
- Type consistency: `runGeminiBatch(modelId, body, apiKey, opts)`, `runOpenAIBatch(params, opts)`, `options.async`, hook exports `asyncGen/setAsyncGen/asyncCapable/asyncElapsed` — names match across tasks.
- Known risk: OpenAI `/v1/images/generations` unproven in batch (spec). The failure-path test (3.2 "endpoint not supported") covers the surfacing behavior.
