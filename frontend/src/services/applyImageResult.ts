import type { GenerateImageResult } from '../types'
import { generateMediaId, saveMediaForProject } from '../mediaStore'
import { bridgeMedia } from '../api'
import { saveMediaMeta, registerBridgeStem } from '../utils/reviewStatus'

export interface ApplyImageContext {
  nodeId: string
  mediaId?: string
  result: GenerateImageResult
  prompt: string
  model: string
  modelName: string
  resolution?: string
  aspectRatio?: string
}

/** Persist a generated image (mediaStore + meta + bridge). Returns the new mediaId. */
export async function applyImageResult(ctx: ApplyImageContext): Promise<{ mediaId: string }> {
  const { nodeId, result, prompt, model, modelName, resolution, aspectRatio } = ctx
  if (!result.image_b64) throw new Error(result.status || 'No image generated')
  const mediaId = ctx.mediaId ?? generateMediaId()
  const response = await fetch(`data:image/png;base64,${result.image_b64}`)
  const blob = await response.blob()
  const file = new File([blob], `generated_${nodeId}.png`, { type: 'image/png' })
  await saveMediaForProject(mediaId, file)
  saveMediaMeta(mediaId, {
    prompt, model, model_name: modelName,
    aspect_ratio: aspectRatio || undefined,
    image_size: resolution || undefined,
    cost_usd: result.usage?.cost_usd,
    generated_at: new Date().toISOString(),
  })
  if (result.bridge_stem) {
    registerBridgeStem(mediaId, result.bridge_stem)
  } else {
    bridgeMedia(result.image_b64, mediaId, {
      prompt, model, modelName,
      aspectRatio: aspectRatio || undefined,
      imageSize: resolution || undefined,
      costUsd: result.usage?.cost_usd,
    }).catch(() => { /* silent */ })
  }
  return { mediaId }
}
