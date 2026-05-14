/**
 * Gemini provider — refactored from geminiDirect.ts into the provider abstraction.
 * Registers gemini (image + LLM) and imagen (image) providers.
 */
import { GoogleGenAI } from '@google/genai'
import type { GenerateImageResult, UsageInfo } from '../types'
import { registerImageProvider, registerLLMProvider, type ImageProvider, type ImageGenerationOptions, type LLMProvider } from './index'
import { MODEL_PRICING } from '../utils/costEstimate'
import { getCachedRegistry } from '../hooks/useModelRegistry'

/**
 * Legacy display-name aliases — old callers could pass a human label
 * like "Gemini 3.1 Pro" instead of an id. New code passes the id
 * directly, but these aliases are kept so settings saved with the old
 * naming still resolve. Unrelated to the registry (not duplicated data).
 */
const MODEL_MAP: Record<string, string> = {
  'Gemini 3.1 Pro': 'gemini-3.1-pro-preview',
  'Gemini 3.1 Flash-Lite': 'gemini-3.1-flash-lite-preview',
  'Gemini 3.1 Flash-Lite Thinking': 'gemini-3.1-flash-lite-preview:thinking',
  'Gemini 3 Flash': 'gemini-3-flash-preview',
  'Gemini 3 Flash Thinking': 'gemini-3-flash-preview:thinking',
  'Gemini 3.1 Flash Image': 'gemini-3.1-flash-image-preview',
  'Gemini 3 Pro Image': 'gemini-3-pro-image-preview',
}

export function resolveModel(nameOrId: string): string {
  return MODEL_MAP[nameOrId] ?? nameOrId
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Gemini image provider (generateContent with IMAGE modality) ─────────────

/**
 * Official Google per-image pricing (fallback, used when the backend
 * registry hasn't loaded yet — e.g. cold start or cloud mode without
 * backend). Kept in sync with src/registry.py cost_per_call; a backend
 * drift test alarms if src/registry.py diverges from the provider
 * MODELS dicts.
 */
const GEMINI_IMAGE_COST_FALLBACK: Record<string, number> = {
  'gemini-3.1-flash-image-preview': 0.067,   // $0.045@0.5K, $0.067@1K, $0.101@2K, $0.151@4K
  'gemini-3-pro-image-preview': 0.134,        // $0.134@1K-2K, $0.240@4K
}

function imageCostFor(modelId: string): number | null {
  const cached = getCachedRegistry()
  if (cached) {
    const entry = cached.find((m) => m.id === modelId)
    if (entry?.cost_per_call != null) return entry.cost_per_call
  }
  return GEMINI_IMAGE_COST_FALLBACK[modelId] ?? null
}

/** Compute cost: fixed per-image for image gen, per-token for text/LLM */
function computeGeminiCost(modelId: string, inputTokens: number, outputTokens: number): number {
  // Image generation: use official fixed per-image price
  const perImage = imageCostFor(modelId)
  if (perImage !== null && outputTokens > 0) return perImage
  // Text/LLM fallback: per-token rates
  const rates = MODEL_PRICING[modelId] ?? [0, 0]
  return (inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1]
}

const geminiImageProvider: ImageProvider = {
  id: 'gemini',
  async generateImage(prompt: string, modelNameOrId: string, apiKey: string, refs?: File[], options?: ImageGenerationOptions): Promise<GenerateImageResult> {
    const ai = new GoogleGenAI({ apiKey })
    const modelId = resolveModel(modelNameOrId)

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ]

    if (refs) {
      for (const ref of refs) {
        const b64 = await fileToBase64(ref)
        parts.push({ inlineData: { mimeType: ref.type || 'image/png', data: b64 } })
      }
    }

    // Map 0.5K → 512 (SDK literal); other buckets pass through.
    const mappedSize = options?.imageSize === '0.5K' ? '512' : options?.imageSize

    // Build imageConfig for resolution and aspect ratio control
    const imageConfig: Record<string, string> = {}
    if (options?.aspectRatio) imageConfig.aspectRatio = options.aspectRatio
    if (mappedSize) imageConfig.imageSize = mappedSize

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: Record<string, any> = {
      responseModalities: ['IMAGE', 'TEXT'],
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
    }
    if (options?.useGrounding) {
      // Per Google docs (gemini-3.1-flash-image-preview), grounding requires
      // explicit searchTypes (webSearch + imageSearch). Sending an empty
      // `googleSearch: {}` was causing degraded/blurred output — the model
      // appeared to fall back to a draft mode without proper search context.
      config.tools = [{
        googleSearch: {
          searchTypes: {
            webSearch: {},
            imageSearch: {},
          },
        },
      }]
    }
    // thinkingConfig is configurable ONLY for gemini-3.1-flash-image-preview.
    // Pro Image (gemini-3-pro-image-preview) has built-in auto-thinking and
    // rejects explicit thinkingConfig with 503 UNAVAILABLE on heavy generations.
    if (modelId === 'gemini-3.1-flash-image-preview' && options?.thinking !== false) {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: 'HIGH',
      }
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: [{ role: 'user', parts }],
      config,
    })

    // Extract usage metadata for cost tracking
    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0
    const costUsd = computeGeminiCost(modelId, inputTokens, outputTokens)
    const usage: UsageInfo | undefined = response.usageMetadata
      ? { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd }
      : undefined

    const candidate = response.candidates?.[0]
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          return { image_b64: part.inlineData.data, status: 'OK', usage }
        }
      }
    }
    return { image_b64: null, status: 'No image generated', usage }
  },
}

// ── Gemini LLM provider ─────────────────────────────────────────────────────

const geminiLLMProvider: LLMProvider = {
  id: 'gemini',
  async chat(prompt: string, modelNameOrId: string, apiKey: string, mediaFiles?: File[]): Promise<{ text: string; status: string; usage?: UsageInfo }> {
    const ai = new GoogleGenAI({ apiKey })
    const modelId = resolveModel(modelNameOrId)

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ]

    if (mediaFiles) {
      for (const f of mediaFiles) {
        const b64 = await fileToBase64(f)
        parts.push({ inlineData: { mimeType: f.type || 'application/octet-stream', data: b64 } })
      }
    }

    let isThinking = modelId.endsWith(':thinking')
    const actualModelId = isThinking ? modelId.replace(':thinking', '') : modelId
    const isGemini3 = actualModelId.startsWith('gemini-3')

    // Gemini 3.1 Pro has thinking always enabled — auto-set thinking config
    if (actualModelId === 'gemini-3.1-pro-preview') {
      isThinking = true
    }

    // Gemini 3 uses thinkingLevel, Gemini 2.5 uses thinkingBudget
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let thinkingConfig: any = undefined
    if (isThinking) {
      thinkingConfig = isGemini3
        ? { includeThoughts: true, thinkingLevel: 'HIGH' }
        : { includeThoughts: true, thinkingBudget: -1 }
    }

    const config = thinkingConfig ? { thinkingConfig } : undefined
    console.log(`[LLM] model=${actualModelId} thinking=${isThinking} config=`, JSON.stringify(config))

    let response
    try {
      response = await ai.models.generateContent({
        model: actualModelId,
        contents: [{ role: 'user', parts }],
        config,
      })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[LLM] API error for model=${actualModelId} thinking=${isThinking}:`, errMsg)
      if (isThinking) {
        console.warn(`[LLM] Retrying ${actualModelId} without thinking config...`)
        response = await ai.models.generateContent({
          model: actualModelId,
          contents: [{ role: 'user', parts }],
        })
      } else {
        throw err
      }
    }

    const allParts = response.candidates?.[0]?.content?.parts ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const thoughtParts = allParts.filter((p: any) => p.thought && p.text).map((p: any) => p.text as string)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const answerParts = allParts.filter((p: any) => !p.thought && p.text).map((p: any) => p.text as string)

    console.log(`[LLM] response: ${allParts.length} parts, ${thoughtParts.length} thoughts, ${answerParts.length} answers`)

    const text = isThinking && thoughtParts.length > 0
      ? `<thinking>\n${thoughtParts.join('\n')}\n</thinking>\n\n${answerParts.join('\n')}`
      : answerParts.join('\n')

    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0
    // Calculate cost from actual token counts (shared pricing table)
    const rates = MODEL_PRICING[actualModelId] ?? [0, 0]
    const costUsd = (inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1]

    const usage: UsageInfo | undefined = response.usageMetadata
      ? { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd }
      : undefined

    return { text, status: 'OK', usage }
  },
}

// ── Register all providers at module scope ──────────────────────────────────

registerImageProvider(geminiImageProvider)
registerLLMProvider(geminiLLMProvider)
