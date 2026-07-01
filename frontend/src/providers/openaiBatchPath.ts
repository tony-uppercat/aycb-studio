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

export interface OpenAIBatchRequest {
  customId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>   // /v1/images/generations body: { model, prompt, n, size, quality }
  refs?: File[]               // when present → edits endpoint, refs uploaded as vision files
}

/**
 * Submit N requests as ONE batch. ALL requests must target the SAME endpoint —
 * the caller guarantees this (groups gen vs edits separately). Endpoint is
 * decided by whether the FIRST request has refs. For an edits batch, every
 * request's refs are uploaded as vision files and injected as body.images
 * [{file_id}] + output_format:'png'. Returns ids for polling + cleanup.
 */
export async function submitOpenAIBatch(
  requests: OpenAIBatchRequest[],
  apiKey: string,
): Promise<{ batchId: string; inputFileId: string; refFileIds: string[]; endpoint: string }> {
  const auth = { 'Authorization': `Bearer ${apiKey}` }
  const endpoint = requests[0]?.refs?.length ? '/v1/images/edits' : '/v1/images/generations'
  const refFileIds: string[] = []
  const lines: string[] = []
  let inputFileId: string | undefined

  try {
    // Parallelize all ref uploads across all requests. Each uploadFile pushes
    // its id into refFileIds synchronously on resolve, so a partial Promise.all
    // failure still leaves the M4 cleanup able to delete every file already up.
    const refsByReq = await Promise.all(requests.map(async req => {
      if (endpoint !== '/v1/images/edits') return [] as string[]
      return Promise.all((req.refs ?? []).map(async ref => {
        const id = await uploadFile(apiKey, ref, ref.name || 'ref.png', 'vision')
        refFileIds.push(id)
        return id
      }))
    }))
    for (let i = 0; i < requests.length; i++) {
      const req = requests[i]
      if (endpoint === '/v1/images/edits') {
        req.body.images = refsByReq[i].map(id => ({ file_id: id }))
        req.body.output_format = 'png'
      }
      lines.push(JSON.stringify({ custom_id: req.customId, method: 'POST', url: endpoint, body: req.body }))
    }

    const jsonl = new Blob([lines.join('\n') + '\n'], { type: 'application/jsonl' })
    inputFileId = await uploadFile(apiKey, jsonl, 'aycb-async.jsonl', 'batch')
    const createResp = await fetch(`${OPENAI_BASE}/batches`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_file_id: inputFileId, endpoint, completion_window: '24h' }),
    })
    if (!createResp.ok) throw new Error(`OpenAI batch create failed: ${await openaiError(createResp)}`)
    const batch = await createResp.json()
    return { batchId: batch.id, inputFileId, refFileIds, endpoint }
  } catch (e) {
    // M4: a failure partway through (a later ref upload, the JSONL upload, or
    // batch-create) would otherwise orphan the files already uploaded above.
    // Best-effort delete every collected id before surfacing the error.
    for (const id of refFileIds) await deleteFileQuiet(apiKey, id)
    await deleteFileQuiet(apiKey, inputFileId)
    throw e
  }
}

/** Cancel a running batch. Best-effort: returns true on 2xx, false otherwise.
 *  OpenAI docs: only stops queued requests; in-flight ones may still bill. */
export async function cancelOpenAIBatch(batchId: string, apiKey: string): Promise<boolean> {
  try {
    const resp = await fetch(`${OPENAI_BASE}/batches/${batchId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    return resp.ok
  } catch {
    return false
  }
}

/** One poll tick. */
export async function pollOpenAIBatch(
  batchId: string,
  apiKey: string,
): Promise<{ done: boolean; status: string; outputFileId: string | null; errorDetail?: string }> {
  const resp = await fetch(`${OPENAI_BASE}/batches/${batchId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  if (!resp.ok) throw new Error(`OpenAI batch poll failed: ${await openaiError(resp)}`)
  const batch = await resp.json()
  return {
    done: TERMINAL.has(batch.status),
    status: batch.status,
    outputFileId: batch.output_file_id ?? null,
    errorDetail: batch.errors?.data?.[0]?.message,
  }
}

/** Download + decode the output file. Keyed by custom_id. usage cost ×0.5. */
export async function fetchOpenAIBatchResults(
  outputFileId: string,
  apiKey: string,
): Promise<Map<string, GenerateImageResult>> {
  const resp = await fetch(`${OPENAI_BASE}/files/${outputFileId}/content`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  if (!resp.ok) throw new Error(`OpenAI batch download failed: ${await openaiError(resp)}`)
  const text = await resp.text()
  const map = new Map<string, GenerateImageResult>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const entry = JSON.parse(line)
    const customId: string = entry.custom_id
    if (entry.error) {
      const msg = entry.error.message ?? JSON.stringify(entry.error).slice(0, 200)
      map.set(customId, { image_b64: null, status: `OpenAI batch request error: ${msg}`, usage: undefined })
      continue
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
    map.set(customId, { image_b64: b64, status: b64 ? 'OK' : 'No image generated', usage })
  }
  return map
}

/** Best-effort delete of input/output/ref files. Never throws. */
export async function cleanupOpenAIBatch(
  apiKey: string,
  ids: { inputFileId?: string | null; outputFileId?: string | null; refFileIds?: string[] },
): Promise<void> {
  for (const id of ids.refFileIds ?? []) await deleteFileQuiet(apiKey, id)
  await deleteFileQuiet(apiKey, ids.inputFileId)
  await deleteFileQuiet(apiKey, ids.outputFileId)
}

export interface OpenAIBatchParams {
  prompt: string
  modelId: string
  apiKey: string
  size: string
  quality: string
  refs?: File[]
  inputFidelity?: 'low' | 'high'
}

/** Back-compat wrapper: one request, await to terminal, return single result. */
export async function runOpenAIBatch(
  params: OpenAIBatchParams,
  opts?: { pollMs?: number },
): Promise<GenerateImageResult> {
  const { prompt, modelId, apiKey, size, quality, refs, inputFidelity } = params
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS

  const body: Record<string, unknown> = { model: modelId, prompt, n: 1, size, quality }
  if (inputFidelity && refs && refs.length > 0) body.input_fidelity = inputFidelity
  const request: OpenAIBatchRequest = {
    customId: 'r0',
    body,
    refs,
  }

  let submitted: { batchId: string; inputFileId: string; refFileIds: string[]; endpoint: string } | null = null
  let outputFileId: string | null = null
  try {
    submitted = await submitOpenAIBatch([request], apiKey)

    // Poll to terminal. The job runs server-side; closing the tab loses the
    // result but not the job (recovery is v2 — see spec).
    let status = ''
    let errorDetail: string | undefined
    for (;;) {
      const tick = await pollOpenAIBatch(submitted.batchId, apiKey)
      status = tick.status
      outputFileId = tick.outputFileId
      errorDetail = tick.errorDetail
      if (tick.done) break
      await sleep(pollMs)
    }

    if (status !== 'completed') {
      return { image_b64: null, status: `OpenAI batch ${status}: ${errorDetail ?? status}`, usage: undefined }
    }
    if (!outputFileId) return { image_b64: null, status: 'OpenAI batch: no output file', usage: undefined }

    const results = await fetchOpenAIBatchResults(outputFileId, apiKey)
    return results.get('r0') ?? { image_b64: null, status: 'OpenAI batch: empty output', usage: undefined }
  } finally {
    // Best-effort cleanup — never masks the real outcome.
    if (submitted) {
      await cleanupOpenAIBatch(apiKey, {
        inputFileId: submitted.inputFileId,
        outputFileId,
        refFileIds: submitted.refFileIds,
      })
    }
  }
}
