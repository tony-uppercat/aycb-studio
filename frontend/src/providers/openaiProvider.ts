/**
 * OpenAI provider — gpt-image-2 image generation and editing.
 *
 * Uses /v1/images/generations for text-to-image and /v1/images/edits when
 * reference images are provided. Pricing is computed from the usage
 * object returned by the API (tokenized: $8/M image input, $30/M image
 * output, $5/M text input) so the cost reported to the user is real,
 * not estimated.
 */
import type { GenerateImageResult, UsageInfo } from '../types'
import { registerImageProvider, type ImageProvider, type ImageGenerationOptions } from './index'
import { runOpenAIBatch } from './openaiBatchPath'

const OPENAI_BASE = 'https://api.openai.com/v1'

/** OpenAI gpt-image-2 size constraints (per official docs 2026-04-21):
 *  - both edges multiples of 16
 *  - max edge ≤ 3840
 *  - total pixels in [655_360, 8_294_400]
 *  - aspect ratio ≤ 3:1
 *  Compute the largest size at the requested AR that fits the target MP
 *  bucket (1K ≈ 1.05 MP, FHD ≈ 2.09 MP / 1920×1088 for 16:9, 2K ≈ 2.4 MP,
 *  4K ≈ 8 MP clamped to 3840 max edge). */
export function computeSize(aspect?: string, resolution?: string): string {
  if (!aspect) return 'auto'
  const [a, b] = aspect.split(':').map(Number)
  if (!a || !b) return 'auto'
  const ratio = a / b
  // AR > 3:1 not supported by the model — fall back to 'auto'
  if (ratio > 3 || ratio < 1 / 3) return 'auto'

  // FHD preset: 1080 isn't a multiple of 16, so 1088 is the closest valid edge.
  // Caller can crop the 8px difference if exact 1920×1080 is required.
  if (resolution === 'FHD') {
    if (aspect === '16:9') return '1920x1088'
    if (aspect === '9:16') return '1088x1920'
    // Other ARs fall through to ~2.1 MP target below.
  }

  // Pre-2026-05-09: only '2K' was handled; '4K' silently fell to 1.05 MP target,
  // generating ~1MP images while billing high quality. Now each bucket maps to
  // its real target; 4K relies on the 3840 max-edge clamp below.
  let targetMp: number
  if (resolution === '4K') targetMp = 8.0
  else if (resolution === '2K') targetMp = 2.4
  else if (resolution === 'FHD') targetMp = 2.1
  else targetMp = 1.05
  const targetPx = targetMp * 1_000_000
  let w = Math.round(Math.sqrt(targetPx * ratio) / 16) * 16
  let h = Math.round((w / ratio) / 16) * 16

  // Clamp max edge to 3840
  const maxEdge = Math.max(w, h)
  if (maxEdge > 3840) {
    const scale = 3840 / maxEdge
    w = Math.round((w * scale) / 16) * 16
    h = Math.round((h * scale) / 16) * 16
  }
  // Bump up if rounding undershot the 655_360 minimum
  while (w * h < 655_360 && Math.max(w, h) < 3840) {
    if (w >= h) { w += 16; h = Math.round((w / ratio) / 16) * 16 }
    else { h += 16; w = Math.round((h * ratio) / 16) * 16 }
  }
  return `${w}x${h}`
}

/** Quality knob — Draft=low (~$0.006/img at 1K), 1K=medium, FHD/2K/4K=high. */
export function resolutionToQuality(res?: string): string {
  if (!res) return 'auto'
  if (res === 'Draft') return 'low'
  if (res === '1K') return 'medium'
  return 'high'
}

/** Token-based pricing per OpenAI public rates (2026-04-21). Exported for the Batch path. */
export function computeCost(usage: {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { text_tokens?: number; image_tokens?: number }
}): number {
  const details = usage.input_tokens_details ?? {}
  const textIn = details.text_tokens ?? usage.input_tokens ?? 0
  const imgIn = details.image_tokens ?? 0
  const imgOut = usage.output_tokens ?? 0
  return (textIn / 1_000_000) * 5 + (imgIn / 1_000_000) * 8 + (imgOut / 1_000_000) * 30
}

async function generateFromText(
  prompt: string,
  modelId: string,
  apiKey: string,
  size: string,
  quality: string,
): Promise<GenerateImageResult> {
  const resp = await fetch(`${OPENAI_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      prompt,
      n: 1,
      size,
      quality,
    }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }))
    throw new Error(err.error?.message ?? `OpenAI error: ${resp.status}`)
  }
  const data = await resp.json()
  const b64 = data.data?.[0]?.b64_json ?? null
  const usage: UsageInfo | undefined = data.usage
    ? {
        input_tokens: data.usage.input_tokens ?? 0,
        output_tokens: data.usage.output_tokens ?? 0,
        cost_usd: computeCost(data.usage),
      }
    : undefined
  return { image_b64: b64, status: b64 ? 'OK' : 'No image generated', usage }
}

async function generateFromEdits(
  prompt: string,
  modelId: string,
  apiKey: string,
  refs: File[],
  size: string,
  quality: string,
): Promise<GenerateImageResult> {
  const fd = new FormData()
  fd.append('model', modelId)
  fd.append('prompt', prompt)
  fd.append('n', '1')
  fd.append('size', size)
  fd.append('quality', quality)
  // OpenAI's /v1/images/edits accepts `image` only for a single reference.
  // For multi-ref it requires the array syntax `image[]` — passing multiple
  // `image` fields returns: "Duplicate parameter: 'image'. ... use the
  // array syntax instead e.g. 'image[]=<value>'." Using `image[]` always
  // works for both single and multi.
  for (const ref of refs) fd.append('image[]', ref, ref.name || 'ref.png')

  const resp = await fetch(`${OPENAI_BASE}/images/edits`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: fd,
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }))
    throw new Error(err.error?.message ?? `OpenAI edit error: ${resp.status}`)
  }
  const data = await resp.json()
  const b64 = data.data?.[0]?.b64_json ?? null
  const usage: UsageInfo | undefined = data.usage
    ? {
        input_tokens: data.usage.input_tokens ?? 0,
        output_tokens: data.usage.output_tokens ?? 0,
        cost_usd: computeCost(data.usage),
      }
    : undefined
  return { image_b64: b64, status: b64 ? 'OK' : 'No image generated', usage }
}

const openaiImageProvider: ImageProvider = {
  id: 'openai',
  async generateImage(
    prompt: string,
    modelId: string,
    apiKey: string,
    refs?: File[],
    options?: ImageGenerationOptions,
  ): Promise<GenerateImageResult> {
    if (!apiKey) throw new Error('OpenAI API key not configured — Settings > API Keys')
    const size = computeSize(options?.aspectRatio, options?.imageSize)
    const quality = resolutionToQuality(options?.imageSize)
    // Async mode: Batch API at 50% cost (awaits result, can take minutes-hours).
    if (options?.async) {
      return runOpenAIBatch({ prompt, modelId, apiKey, size, quality, refs })
    }
    if (refs && refs.length > 0) {
      return generateFromEdits(prompt, modelId, apiKey, refs, size, quality)
    }
    return generateFromText(prompt, modelId, apiKey, size, quality)
  },
}

registerImageProvider(openaiImageProvider)
