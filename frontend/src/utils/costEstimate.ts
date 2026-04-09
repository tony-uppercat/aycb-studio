/**
 * Client-side cost estimation for Gemini API calls.
 *
 * Uses documented token rates:
 * - Text: ~4 characters per token
 * - Image: ~258 tokens per image
 * - Video: ~263 tokens per second
 * - Audio: ~32 tokens per second
 *
 * Output tokens are estimated per operation type based on observed averages.
 */

// Cost per 1M tokens (USD): [input, output]
export const MODEL_PRICING: Record<string, [number, number]> = {
  // Gemini 3.1 (text/LLM)
  'gemini-3.1-pro-preview':           [2.00, 12.00],
  'gemini-3.1-flash-lite-preview':    [0.25,  1.50],
  // Nano Banana 2 (Gemini 3.1 Flash Image) — ~$0.067/image @1K, $0.15 @4K
  'gemini-3.1-flash-image-preview':   [0.50, 60.00],
  // Gemini 3 (text/LLM)
  'gemini-3-flash-preview':           [0.50,  3.00],
  // Nano Banana Pro (Gemini 3 Pro Image) — ~$0.134/image @1K-2K, $0.24 @4K
  'gemini-3-pro-image-preview':       [2.00, 120.00],
  // Gemini 2.5 (legacy — kept for historical cost lookups)
  'gemini-2.5-flash':                 [0.30,  2.50],
  'gemini-2.5-pro':                   [1.25, 10.00],
  // Claude models (approximate)
  'claude-sonnet-4-6-20250620':       [3.00, 15.00],
  'claude-opus-4-6-20250620':         [15.00, 75.00],
  'claude-haiku-4-5-20251001':        [0.80, 4.00],
  // Flux models (BFL API — approximated per image as output tokens)
  'flux-2-klein-4b':                    [0, 14.00],
  'flux-2-klein-9b':                    [0, 15.00],
  // Local models (free)
  'local/flux-2-klein-4b':             [0, 0],
  'local/flux-2-klein-9b':             [0, 0],
}

// Average output tokens by operation type
const AVG_OUTPUT_TOKENS: Record<string, number> = {
  'analyze_image': 1200,
  'analyze_video': 1500,   // per frame
  'generate_image': 1000,
  'llm_chat': 800,
}

/** Estimate tokens for a text string */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/** Estimate tokens for an image (fixed rate) */
export function estimateImageTokens(): number {
  return 258
}

/** Estimate tokens for a video by duration in seconds */
export function estimateVideoTokens(durationSec: number): number {
  return Math.ceil(durationSec * 263)
}

export interface CostEstimate {
  inputTokens: number
  outputTokens: number
  costUsd: number
  model: string
}

/**
 * Estimate cost for an API call.
 * @param modelId - The model ID (e.g., 'gemini-3-flash-preview')
 * @param operation - Operation type: 'analyze_image' | 'analyze_video' | 'generate_image' | 'llm_chat'
 * @param promptText - The text prompt
 * @param imageCount - Number of input images
 * @param videoDurationSec - Video duration in seconds (for video analysis)
 * @param nFrames - Number of frames (for video analysis, multiplies output estimate)
 */
export function estimateCost(
  modelId: string,
  operation: string,
  promptText: string = '',
  imageCount: number = 0,
  videoDurationSec: number = 0,
  nFrames: number = 1,
  resolution: string = '',
): CostEstimate {
  const inputTokens =
    estimateTextTokens(promptText) +
    imageCount * estimateImageTokens() +
    estimateVideoTokens(videoDurationSec)

  const outputTokens = (AVG_OUTPUT_TOKENS[operation] ?? 500) * (operation === 'analyze_video' ? nFrames : 1)

  // Strip :thinking suffix for pricing lookup
  const pricingModelId = modelId.endsWith(':thinking') ? modelId.replace(':thinking', '') : modelId

  // Image generation: use official fixed per-image pricing (Google charges per image, not per token)
  // Prices vary by resolution — imageSize passed via imageCount overload won't work,
  // so we expose resolution-aware maps and let the caller pass the right imageCount for input refs.
  if (operation === 'generate_image') {
    const FIXED_IMAGE_COST: Record<string, Record<string, number>> = {
      'gemini-3.1-flash-image-preview': { '512': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151, '': 0.067 },
      'gemini-3-pro-image-preview':     { '1K': 0.134, '2K': 0.134, '4K': 0.240, '': 0.134 },
    }
    const resMap = FIXED_IMAGE_COST[pricingModelId]
    if (resMap !== undefined) {
      const imgCost = resMap[resolution] ?? resMap[''] ?? 0.067
      // Add input cost for reference images (edit mode): ~560 tokens per image
      const inputRefCost = imageCount > 0 ? (imageCount * 560 / 1_000_000) * (MODEL_PRICING[pricingModelId]?.[0] ?? 0.50) : 0
      return { inputTokens: imageCount * 560, outputTokens: 0, costUsd: imgCost + inputRefCost, model: modelId }
    }
  }

  const pricing = MODEL_PRICING[pricingModelId]
  if (!pricing) return { inputTokens, outputTokens, costUsd: 0, model: pricingModelId }

  const inCost = (inputTokens / 1_000_000) * pricing[0]
  const outCost = (outputTokens / 1_000_000) * pricing[1]

  return {
    inputTokens,
    outputTokens,
    costUsd: inCost + outCost,
    model: modelId,
  }
}

/** Format cost for display: "~$0.0012" */
export function formatCostEstimate(costUsd: number): string {
  if (costUsd === 0) return ''
  if (costUsd < 0.001) return `~$${costUsd.toFixed(5)}`
  if (costUsd < 0.01) return `~$${costUsd.toFixed(4)}`
  return `~$${costUsd.toFixed(3)}`
}
