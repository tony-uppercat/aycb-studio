/**
 * Gemini provider — refactored from geminiDirect.ts into the provider abstraction.
 * Registers gemini (image + LLM) and imagen (image) providers.
 */
import { GoogleGenAI } from '@google/genai'
import type { GenerateImageResult, UsageInfo } from '../types'
import { registerImageProvider, registerLLMProvider, type ImageProvider, type ImageGenerationOptions, type LLMProvider } from './index'
import { MODEL_PRICING } from '../utils/costEstimate'
import { imageCostFor, parseGenerateContentResponse } from './geminiShared'

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
  'Imagen 4 Ultra': 'imagen-4.0-ultra-generate-001',
  'Imagen 4 Fast': 'imagen-4.0-fast-generate-001',
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
// Per-image pricing + response parsing live in ./geminiShared (also used by
// the async Batch API path in ./geminiBatchPath).

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
    // Canonical casing is lowercase ("minimal" / "high").
    //
    // At imageSize 2K/4K, explicit thinkingLevel=high silently degrades the
    // output to the 1K bucket (768×1376 at 9:16) — confirmed empirically via
    // scripts/smoke_test_nb2_imagesize.py vs in-app reports. Omit thinkingConfig
    // at high res so the API falls back to default `minimal` which honors
    // imageSize. See memory feedback_gemini_thinking_imagesize.
    const isHighRes = options?.imageSize === '2K' || options?.imageSize === '4K'
    if (
      modelId === 'gemini-3.1-flash-image-preview'
      && options?.thinking !== false
      && !isHighRes
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
    return parseGenerateContentResponse(data, modelId)
  },
}

// ── Imagen provider (generateImages API) ────────────────────────────────────
// Sunset 2026-06-24. Text-to-image only — refs not supported by the API.

const imagenImageProvider: ImageProvider = {
  id: 'imagen',
  async generateImage(prompt: string, modelNameOrId: string, apiKey: string, _refs?: File[], options?: ImageGenerationOptions): Promise<GenerateImageResult> {
    const ai = new GoogleGenAI({ apiKey })
    const modelId = resolveModel(modelNameOrId)

    const response = await ai.models.generateImages({
      model: modelId,
      prompt,
      config: {
        numberOfImages: 1,
        ...(options?.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
      },
    })

    const perImageCost = imageCostFor(modelId) ?? 0
    const usage: UsageInfo = { input_tokens: 0, output_tokens: 0, cost_usd: perImageCost }

    const img = response.generatedImages?.[0]
    if (img?.image?.imageBytes) {
      return { image_b64: img.image.imageBytes, status: 'OK', usage }
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
registerImageProvider(imagenImageProvider)
registerLLMProvider(geminiLLMProvider)
