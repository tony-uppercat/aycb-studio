/**
 * Shared Gemini image-generation helpers — response parsing and cost,
 * used by both the sync REST path (geminiProvider) and the async
 * Batch API path (geminiBatchPath).
 */
import type { GenerateImageResult, UsageInfo } from '../types'
import { MODEL_PRICING } from '../utils/costEstimate'
import { getCachedRegistry } from '../hooks/useModelRegistry'

/**
 * Resolution-aware Google per-image pricing (fallback, used when the
 * backend registry hasn't loaded yet — e.g. cold start or cloud mode
 * without backend). Keyed by imageSize tier ('0.5K'|'1K'|'2K'|'4K'),
 * with '' as the default when the size is unknown. Mirrors the
 * FIXED_IMAGE_COST tiered maps in utils/costEstimate.ts — keep both in
 * sync. Kept in sync with src/registry.py cost_per_call; a backend
 * drift test alarms if src/registry.py diverges from the provider
 * MODELS dicts.
 */
const GEMINI_IMAGE_COST_FALLBACK: Record<string, Record<string, number>> = {
  'gemini-3.1-flash-image-preview': { '0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151, '': 0.067 },
  'gemini-3-pro-image-preview':     { '1K': 0.134, '2K': 0.134, '4K': 0.240, '': 0.134 },
}

/**
 * Per-image cost for a Gemini image model at a given resolution tier.
 * `imageSize` is one of '0.5K'|'1K'|'2K'|'4K' (or '' / undefined when
 * unknown, which falls back to the model's default-tier price). The
 * backend registry only exposes a single flat `cost_per_call`, so it is
 * used solely when no resolution-aware fallback entry exists.
 */
export function imageCostFor(modelId: string, imageSize = ''): number | null {
  const resMap = GEMINI_IMAGE_COST_FALLBACK[modelId]
  if (resMap !== undefined) return resMap[imageSize] ?? resMap[''] ?? null

  const cached = getCachedRegistry()
  if (cached) {
    const entry = cached.find((m) => m.id === modelId)
    if (entry?.cost_per_call != null) return entry.cost_per_call
  }
  return null
}

/**
 * Compute cost: resolution-aware fixed per-image for image gen,
 * per-token for text/LLM. `multiplier` scales the result (0.5 = Batch
 * API discount). `imageSize` selects the per-image resolution tier.
 */
export function computeGeminiCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  multiplier = 1,
  imageSize = '',
): number {
  const perImage = imageCostFor(modelId, imageSize)
  if (perImage !== null && outputTokens > 0) return perImage * multiplier
  const rates = MODEL_PRICING[modelId] ?? [0, 0]
  return ((inputTokens / 1_000_000) * rates[0] + (outputTokens / 1_000_000) * rates[1]) * multiplier
}

/**
 * GenerateContentResponse JSON → GenerateImageResult. Tolerates both
 * camelCase (SDK style) and snake_case (REST raw) field names.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseGenerateContentResponse(data: any, modelId: string, costMultiplier = 1, imageSize = ''): GenerateImageResult {
  const um = data.usageMetadata ?? data.usage_metadata ?? {}
  const inputTokens = um.promptTokenCount ?? um.prompt_token_count ?? 0
  const outputTokens = um.candidatesTokenCount ?? um.candidates_token_count ?? 0
  const usage: UsageInfo | undefined = (inputTokens > 0 || outputTokens > 0)
    ? {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: computeGeminiCost(modelId, inputTokens, outputTokens, costMultiplier, imageSize),
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
