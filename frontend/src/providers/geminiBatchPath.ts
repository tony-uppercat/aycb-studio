/**
 * Gemini Batch API path — async generation at 50% cost.
 *
 * One INLINE request per run (payload < 20MB cap; refs are inline anyway
 * in the sync path). submit → poll (10s, doc cadence) → decode. Returns
 * the same GenerateImageResult as the sync REST path so the caller
 * (geminiProvider.generateImage) is transparent to the mode.
 *
 * Result shape verified live 2026-06-11 via
 * scripts/smoke_test_gemini_batch_inline.py (memory
 * feedback_verify_empirically): the inlined entry sits at
 * op.response.inlinedResponses.inlinedResponses[0], camelCase fields,
 * image bytes are JPEG even when PNG is implied downstream (harmless —
 * browsers sniff the real type).
 */
import type { GenerateImageResult } from '../types'
import { parseGenerateContentResponse } from './geminiShared'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const TERMINAL = new Set([
  'BATCH_STATE_SUCCEEDED', 'BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED',
])
export const GEMINI_BATCH_DISCOUNT = 0.5
const DEFAULT_POLL_MS = 10_000

/**
 * Image models accepting batchGenerateContent. GA ids only; pre-migration
 * preview ids are rewritten to GA by resolveModel (MODEL_MAP reverse
 * aliases) before this gate is reached. flash-image/pro-image verified
 * 2026-06-11; Nano Banana 2 Lite (gemini-3.1-flash-lite-image) verified
 * live 2026-07-01 (batchGenerateContent submit accepted). Lite is 1K-only
 * (2K/4K rejected by the model), so no high-res batch concern.
 */
const GEMINI_BATCH_MODELS = new Set([
  'gemini-3-pro-image',
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-2.5-flash-image',
])

export function geminiSupportsBatch(modelId: string): boolean {
  return GEMINI_BATCH_MODELS.has(modelId)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

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

/** All inlined entries from a finished op, keyed by metadata.key (fallback: index). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractAllInlineEntries(op: any): Map<string, any> {
  const inlined = op?.response?.inlinedResponses
  const arr = Array.isArray(inlined) ? inlined : inlined?.inlinedResponses
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = new Map<string, any>()
  if (!Array.isArray(arr)) return out
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        display_name: `aycb-async-${requests[0]?.key ?? requests.length}`,
        input_config: { requests: { requests: requests.map(r => ({ request: r.body, metadata: { key: r.key } })) } },
      },
    }),
  })
  if (!submitResp.ok) throw new Error(`Gemini batch submit failed: ${await googleError(submitResp)}`)
  const opName = (await submitResp.json()).name as string
  if (!opName) throw new Error('Gemini batch submit returned no operation name')
  return opName
}

/** Cancel a running batch operation. Best-effort: returns true on 2xx, false otherwise.
 *  Never throws — caller still marks the local job cancelled regardless. */
export async function cancelGeminiBatch(opName: string, apiKey: string): Promise<boolean> {
  try {
    const resp = await fetch(`${BASE}/${opName}:cancel`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey },
    })
    return resp.ok
  } catch {
    return false
  }
}

/** One poll tick. Returns done flag + the raw op when terminal. */
export async function pollGeminiBatch(
  opName: string,
  apiKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ done: boolean; op: any; state: string }> {
  const headers = { 'x-goog-api-key': apiKey }
  const pollResp = await fetch(`${BASE}/${opName}`, { headers })
  if (!pollResp.ok) throw new Error(`Gemini batch poll failed: ${await googleError(pollResp)}`)
  const op = await pollResp.json()
  const state = op.metadata?.state ?? ''
  const done = Boolean(op.done) || TERMINAL.has(state)
  return { done, op, state }
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

  const opName = await submitGeminiBatch(modelId, [{ body: requestBody, key: 'r0' }], apiKey)

  // Poll until terminal. The job runs server-side; closing the tab loses the
  // result but not the job (recovery is v2 — see spec).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let op: any
  for (;;) {
    await sleep(pollMs)
    const tick = await pollGeminiBatch(opName, apiKey)
    op = tick.op
    if (tick.done) break
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
