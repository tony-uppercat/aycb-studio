import type { GenerateImageResult, UsageInfo } from '../types'
import { registerImageProvider, type ImageProvider, type ImageGenerationOptions } from './index'
import { getCachedRegistry } from '../hooks/useModelRegistry'

const RECRAFT_BASE = 'https://external.api.recraft.ai/v1'

const RECRAFT_PRICING_FALLBACK: Record<string, number> = {
  'recraftv4': 0.04,
  'recraftv4_pro': 0.25,
  'recraftv4_vector': 0.08,
  'recraftv4_pro_vector': 0.30,
}

function recraftCostFor(modelId: string): number {
  const cached = getCachedRegistry()
  if (cached) {
    const entry = cached.find((m) => m.id === modelId)
    if (entry?.cost_per_call != null) return entry.cost_per_call
  }
  return RECRAFT_PRICING_FALLBACK[modelId] ?? 0
}

/** Target ~1MP for standard, ~4MP for Pro. Returns WxH string. */
function computeSize(aspect?: string, modelId?: string): string {
  const isPro = modelId?.includes('_pro') ?? false
  const targetPx = isPro ? 4_000_000 : 1_000_000
  if (!aspect) {
    const side = Math.round(Math.sqrt(targetPx) / 64) * 64
    return `${side}x${side}`
  }
  const [a, b] = aspect.split(':').map(Number)
  if (!a || !b) {
    const side = Math.round(Math.sqrt(targetPx) / 64) * 64
    return `${side}x${side}`
  }
  const ratio = a / b
  let w = Math.round(Math.sqrt(targetPx * ratio) / 64) * 64
  let h = Math.round((w / ratio) / 64) * 64
  // Clamp to reasonable bounds
  const maxEdge = isPro ? 4096 : 2048
  const biggest = Math.max(w, h)
  if (biggest > maxEdge) {
    const scale = maxEdge / biggest
    w = Math.round((w * scale) / 64) * 64
    h = Math.round((h * scale) / 64) * 64
  }
  return `${w}x${h}`
}

const recraftProvider: ImageProvider = {
  id: 'recraft',
  async generateImage(
    prompt: string,
    modelId: string,
    apiKey: string,
    _refs?: File[],
    options?: ImageGenerationOptions,
  ): Promise<GenerateImageResult> {
    if (!apiKey) throw new Error('Recraft API key not configured — Settings > API Keys')

    const size = computeSize(options?.aspectRatio, modelId)

    const resp = await fetch(`${RECRAFT_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        model: modelId,
        n: 1,
        size,
        response_format: 'b64_json',
      }),
    })

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: { message: resp.statusText } }))
      const msg = err.error?.message ?? err.detail ?? err.message ?? `Recraft error: ${resp.status}`
      throw new Error(msg)
    }

    const data = await resp.json()
    const b64: string | null = data.data?.[0]?.b64_json ?? null
    if (!b64) throw new Error('Recraft returned no image data')

    const usage: UsageInfo = {
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: recraftCostFor(modelId),
    }

    return { image_b64: b64, status: 'OK', usage }
  },
}

registerImageProvider(recraftProvider)
