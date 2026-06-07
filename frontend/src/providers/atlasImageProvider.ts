/**
 * Atlas Cloud image provider — Flux 2 Pro (Black Forest Labs).
 *
 * Atlas image generation is async: POST /model/generateImage → returns
 * { data: { id } } → poll GET /model/prediction/{id} until status=completed
 * → outputs[0] is the result URL. Pattern matches src/atlas_video_gen.py.
 *
 * Image-to-image: pass the first ref as a base64 data URI in
 * `reference_image_url`. Atlas accepts one ref per request for Flux 2 Pro.
 */
import type { GenerateImageResult, UsageInfo } from '../types'
import { registerImageProvider, type ImageProvider, type ImageGenerationOptions } from './index'
import { getCachedRegistry } from '../hooks/useModelRegistry'

const BASE_URL = 'https://api.atlascloud.ai/api/v1'

const FLUX_DIMS: Record<string, { width: number; height: number }> = {
  '1:1':  { width: 1024, height: 1024 },
  '4:3':  { width: 1152, height: 896 },
  '3:4':  { width: 896,  height: 1152 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768,  height: 1344 },
}

const ATLAS_MODEL_IDS: Record<string, string> = {
  'atlas-flux-2-pro': 'black-forest-labs/flux-2-pro/text-to-image',
}

const ATLAS_PRICING_FALLBACK: Record<string, number> = {
  'atlas-flux-2-pro': 0.04,
}

function dimsFor(aspectRatio?: string): { width: number; height: number } {
  if (!aspectRatio) return FLUX_DIMS['1:1']
  return FLUX_DIMS[aspectRatio] ?? FLUX_DIMS['1:1']
}

function atlasCostFor(modelId: string): number {
  const cached = getCachedRegistry()
  if (cached) {
    const entry = cached.find((m) => m.id === modelId)
    if (entry?.cost_per_call != null) return entry.cost_per_call
  }
  return ATLAS_PRICING_FALLBACK[modelId] ?? 0
}

async function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function pollForResult(apiKey: string, predictionId: string, maxAttempts = 120): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000))
    const res = await fetch(`${BASE_URL}/model/prediction/${predictionId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) throw new Error(`Atlas polling error: ${res.status}`)
    const raw = await res.json()
    const data = raw.data ?? {}
    const status = (data.status ?? '').toLowerCase()
    if (status === 'completed' || status === 'succeeded') {
      const url = (data.outputs ?? [])[0]
      if (!url) throw new Error('Atlas returned completed but no output URL')
      return url
    }
    if (status === 'failed') {
      throw new Error(`Atlas generation failed: ${data.error ?? 'unknown'}`)
    }
  }
  throw new Error('Atlas generation timed out')
}

const atlasImageProvider: ImageProvider = {
  id: 'atlas',
  async generateImage(
    prompt: string,
    modelId: string,
    apiKey: string,
    refs?: File[],
    options?: ImageGenerationOptions,
  ): Promise<GenerateImageResult> {
    const atlasModel = ATLAS_MODEL_IDS[modelId] ?? modelId
    const { width, height } = dimsFor(options?.aspectRatio)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
      model: atlasModel,
      prompt,
      width,
      height,
    }

    // I2I — pass the first ref as a base64 data URI. Atlas accepts one ref
    // per request for Flux 2 Pro; extras are ignored.
    if (refs && refs.length > 0) {
      payload.reference_image_url = await fileToDataUri(refs[0])
    }

    const submit = await fetch(`${BASE_URL}/model/generateImage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!submit.ok) {
      const errText = await submit.text().catch(() => `HTTP ${submit.status}`)
      throw new Error(`Atlas submit failed (${submit.status}): ${errText}`)
    }
    const submitData = await submit.json()
    const predictionId = submitData?.data?.id
    if (!predictionId) throw new Error(`Atlas missing prediction id: ${JSON.stringify(submitData)}`)

    const imageUrl = await pollForResult(apiKey, predictionId)

    const imgResp = await fetch(imageUrl)
    if (!imgResp.ok) throw new Error(`Failed to download Atlas image: ${imgResp.status}`)
    const blob = await imgResp.blob()
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.readAsDataURL(blob)
    })

    const usage: UsageInfo = { input_tokens: 0, output_tokens: 0, cost_usd: atlasCostFor(modelId) }
    return { image_b64: base64, status: 'OK', usage }
  },
}

registerImageProvider(atlasImageProvider)
