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

    // 3. poll to terminal. The job runs server-side; closing the tab loses
    //    the result but not the job (recovery is v2 — see spec).
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
    // Best-effort cleanup — never masks the real outcome.
    for (const id of refFileIds) await deleteFileQuiet(apiKey, id)
    await deleteFileQuiet(apiKey, inputFileId)
    await deleteFileQuiet(apiKey, outputFileId)
  }
}
