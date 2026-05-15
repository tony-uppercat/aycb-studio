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
  // Display-name → id aliases (legacy callers passing labels rather than ids)
  'Gemini 3.1 Pro': 'gemini-3.1-pro-preview',
  'Gemini 3.1 Flash-Lite': 'gemini-3.1-flash-lite',
  'Gemini 3.1 Flash-Lite Thinking': 'gemini-3.1-flash-lite:thinking',
  'Gemini 3 Flash': 'gemini-3-flash-preview',
  'Gemini 3 Flash Thinking': 'gemini-3-flash-preview:thinking',
  'Gemini 3.1 Flash Image': 'gemini-3.1-flash-image-preview',
  'Gemini 3 Pro Image': 'gemini-3-pro-image-preview',
  // Migration aliases — saved canvases serialized before 2026-05-14 carry the
  // -preview id; rewrite to GA before the HTTP call so the API still resolves.
  // Safe to remove after 2026-06-30.
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview:thinking': 'gemini-3.1-flash-lite:thinking',
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
    const modelId = resolveModel(modelNameOrId)

    // Build parts: text prompt + optional inline_data per ref.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [{ text: prompt }]
    if (refs) {
      for (const ref of refs) {
        const b64 = await fileToBase64(ref)
        parts.push({ inline_data: { mime_type: ref.type || 'image/png', data: b64 } })
      }
    }

    // Map 0.5K → 512 (SDK literal); other buckets pass through.
    const mappedSize = options?.imageSize === '0.5K' ? '512' : options?.imageSize

    const imageConfig: Record<string, string> = {}
    if (options?.aspectRatio) imageConfig.aspectRatio = options.aspectRatio
    if (mappedSize) imageConfig.imageSize = mappedSize

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const generationConfig: Record<string, any> = {
      responseModalities: ['IMAGE', 'TEXT'],
      ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
    }
    // thinkingConfig is configurable ONLY for gemini-3.1-flash-image-preview.
    // Pro Image has built-in auto-thinking and rejects explicit thinkingConfig.
    // Empirically (smoke_test_flash_thinking_4k + smoke_test_flash_2k_thinking_repeat):
    // Flash + thinkingConfig HIGH + imageSize >= 2K → API silently degrades to 1K
    // and frequently returns IMAGE_RECITATION blocks. We omit thinkingConfig at
    // 2K/4K so the requested size is honored.
    // When omitted at 2K/4K, the API falls back to the default `minimal` level
    // (thinking cannot be disabled — only modulated). Doc canonical casing is
    // lowercase ("minimal" / "high"); legacy uppercase appears in some Google
    // examples but the thinking doc page prefers lowercase.
    const thinkingIncompatibleSize = options?.imageSize === '2K' || options?.imageSize === '4K'
    if (
      modelId === 'gemini-3.1-flash-image-preview'
      && options?.thinking !== false
      && !thinkingIncompatibleSize
    ) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: 'high',
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      contents: [{ role: 'user', parts }],
      generationConfig,
    }
    if (options?.useGrounding) {
      body.tools = [{
        googleSearch: {
          searchTypes: {
            webSearch: {},
            imageSearch: {},
          },
        },
      }]
    }

    // Direct REST call — bypasses @google/genai SDK which silently drops
    // imageConfig.imageSize (googleapis/js-genai Issue #1461, still open).
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`)
      // Try to extract Google's structured error message.
      let detail = errText
      try {
        const parsed = JSON.parse(errText)
        detail = parsed.error?.message ?? errText
      } catch { /* keep raw */ }
      return { image_b64: null, status: `Gemini API error: ${detail}`, usage: undefined }
    }

    const data = await response.json()

    // Extract usage metadata for cost tracking (REST shape uses snake_case in
    // some fields, camelCase in others — try both).
    const um = data.usageMetadata ?? data.usage_metadata ?? {}
    const inputTokens = um.promptTokenCount ?? um.prompt_token_count ?? 0
    const outputTokens = um.candidatesTokenCount ?? um.candidates_token_count ?? 0
    const costUsd = computeGeminiCost(modelId, inputTokens, outputTokens)
    const usage: UsageInfo | undefined = (inputTokens > 0 || outputTokens > 0)
      ? { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd }
      : undefined

    // Extract first inline image part. Try both camelCase (SDK style) and
    // snake_case (REST raw) field names.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidate = data.candidates?.[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partsResp: any[] = candidate?.content?.parts ?? []
    for (const part of partsResp) {
      const inline = part.inlineData ?? part.inline_data
      if (inline?.data) {
        return { image_b64: inline.data, status: 'OK', usage }
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
        ? { includeThoughts: true, thinkingLevel: 'high' }
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
