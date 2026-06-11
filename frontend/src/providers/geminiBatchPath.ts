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
 * Image models accepting batchGenerateContent — verified against
 * ListModels 2026-06-11. flash-LITE-image 404s on batch.
 */
const GEMINI_BATCH_MODELS = new Set([
  'gemini-3-pro-image-preview',
  'gemini-3-pro-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-image',
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

  // Poll until terminal. The job runs server-side; closing the tab loses the
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
