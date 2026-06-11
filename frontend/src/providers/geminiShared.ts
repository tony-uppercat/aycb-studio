/**
 * Shared Gemini image-generation helpers — response parsing and cost,
 * used by both the sync REST path (geminiProvider) and the async
 * Batch API path (geminiBatchPath).
 */
import type { GenerateImageResult, UsageInfo } from '../types'
import { MODEL_PRICING } from '../utils/costEstimate'
import { getCachedRegistry } from '../hooks/useModelRegistry'

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

export function imageCostFor(modelId: string): number | null {
  const cached = getCachedRegistry()
  if (cached) {
    const entry = cached.find((m) => m.id === modelId)
    if (entry?.cost_per_call != null) return entry.cost_per_call
  }
  return GEMINI_IMAGE_COST_FALLBACK[modelId] ?? null
}

/**
 * Compute cost: fixed per-image for image gen, per-token for text/LLM.
 * `multiplier` scales the result (0.5 = Batch API discount).
 */
export function computeGeminiCost(modelId: string, inputTokens: number, outputTokens: number, multiplier = 1): number {
  const perImage = imageCostFor(modelId)
  if (perImage !== null && outputTokens > 0) return perImage * multiplier
  const rates = MODEL_PRICING[modelId] ?? [0, 0]
  return ((inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1]) * multiplier
}

/**
 * GenerateContentResponse JSON → GenerateImageResult. Tolerates both
 * camelCase (SDK style) and snake_case (REST raw) field names.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseGenerateContentResponse(data: any, modelId: string, costMultiplier = 1): GenerateImageResult {
  const um = data.usageMetadata ?? data.usage_metadata ?? {}
  const inputTokens = um.promptTokenCount ?? um.prompt_token_count ?? 0
  const outputTokens = um.candidatesTokenCount ?? um.candidates_token_count ?? 0
  const usage: UsageInfo | undefined = (inputTokens > 0 || outputTokens > 0)
    ? {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: computeGeminiCost(modelId, inputTokens, outputTokens, costMultiplier),
      }
    : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = data.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data
    if (inline?.data) return { image_b64: inline.data, status: 'OK', usage }
  }
  return { image_b64: null, status: 'No image generated', usage }
}
