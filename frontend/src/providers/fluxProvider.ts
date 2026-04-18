import type { GenerateImageResult, UsageInfo } from '../types'
import { registerImageProvider, type ImageProvider } from './index'
import { getCachedRegistry } from '../hooks/useModelRegistry'

/**
 * BFL API model id pass-through. The backend registry is the source of
 * truth; this fallback is consulted only if the registry hasn't
 * resolved (cold start, cloud mode). Kept in sync with
 * src/registry.py — a backend drift test alarms on divergence.
 */
const BFL_MODELS_FALLBACK: Record<string, string> = {
  'flux-2-klein-4b': 'flux-2-klein-4b',
  'flux-2-klein-9b': 'flux-2-klein-9b',
}
const FLUX_PRICING_FALLBACK: Record<string, number> = {
  'flux-2-klein-4b': 0.014,
  'flux-2-klein-9b': 0.015,
}

function resolveBflModel(id: string): string {
  // BFL uses the same id the registry publishes; pass-through is correct.
  return BFL_MODELS_FALLBACK[id] ?? id
}

function fluxCostFor(modelId: string): number {
  const cached = getCachedRegistry()
  if (cached) {
    const entry = cached.find((m) => m.id === modelId)
    if (entry?.cost_per_call != null) return entry.cost_per_call
  }
  return FLUX_PRICING_FALLBACK[modelId] ?? 0
}

async function pollForResult(pollingUrl: string, maxAttempts = 60): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 500))
    const res = await fetch(pollingUrl)
    if (!res.ok) throw new Error(`BFL polling error: ${res.status}`)
    const data = await res.json()
    if (data.status === 'Ready') {
      const url = data.result?.sample
      if (!url) throw new Error('BFL returned Ready but no image URL')
      return url
    }
    if (data.status === 'Error' || data.status === 'Failed') {
      throw new Error(`BFL generation failed: ${data.status}`)
    }
  }
  throw new Error('BFL generation timed out')
}

const fluxProvider: ImageProvider = {
  id: 'flux-cloud',
  async generateImage(prompt: string, modelId: string, apiKey: string): Promise<GenerateImageResult> {
    const bflModel = resolveBflModel(modelId)

    // Submit generation request to BFL API
    const response = await fetch(`https://api.bfl.ai/v1/${bflModel}`, {
      method: 'POST',
      headers: {
        'x-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        width: 1024,
        height: 1024,
        output_format: 'png',
      }),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }))
      throw new Error(err.detail ?? err.message ?? `BFL error: ${response.status}`)
    }
    const { polling_url } = await response.json()
    if (!polling_url) throw new Error('BFL did not return a polling URL')

    // Poll until image is ready
    const imageUrl = await pollForResult(polling_url)

    // Fetch image and convert to base64
    const imgResponse = await fetch(imageUrl)
    if (!imgResponse.ok) throw new Error(`Failed to download BFL image: ${imgResponse.status}`)
    const blob = await imgResponse.blob()
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.readAsDataURL(blob)
    })
    // Flux uses fixed per-image pricing (no token usage). Cost sourced
    // from the registry when available, else the hardcoded fallback.
    const usage: UsageInfo = { input_tokens: 0, output_tokens: 0, cost_usd: fluxCostFor(bflModel) }
    return { image_b64: base64, status: 'OK', usage }
  }
}

registerImageProvider(fluxProvider)
