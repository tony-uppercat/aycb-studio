/**
 * Quick-add aliases for the Tab AddNodeMenu.
 *
 * Type a short alias in the search box (e.g. `nb2`, `gpt`, `opus`, `kling`)
 * and an alias row appears at the top of the menu. Press Enter → the
 * corresponding node is added with `selectedModel` (and optionally
 * `aspectRatio`/`resolution`/etc.) pre-set.
 *
 * Alias matching: case-insensitive, prefix match. The shortest aliases that
 * SHOULD remain ambiguous (e.g. `o` could match Opus or OpenAI) are intentionally
 * not in this table — only meaningful 2-6 character aliases.
 */
import type { NodeManifest } from './_shared/types'

export interface QuickAlias {
  /** Lowercase alias the user types. */
  alias: string
  /** Which catalog node type to create. */
  nodeType: 'llm' | 'generateImage' | 'generateVideo' | 'colorCorrection'
  /** Display name in the menu row. */
  label: string
  /** One-line description (model name + provider hint). */
  description: string
  /** Overrides merged into the base manifest's defaultData. */
  dataOverride: Record<string, unknown>
}

export const QUICK_ALIASES: QuickAlias[] = [
  // ── Images (generateImage) ─────────────────────────────────────────────
  { alias: 'nb', nodeType: 'generateImage', label: 'Image · Nano Banana Pro',
    description: 'Gemini 3 Pro Image — best quality, 1K–4K',
    dataOverride: { selectedModel: 'gemini-3-pro-image', resolution: '4K', aspectRatio: '16:9' } },
  { alias: 'nb2', nodeType: 'generateImage', label: 'Image · Nano Banana 2',
    description: 'Gemini 3.1 Flash Image — fast, 0.5K–4K',
    dataOverride: { selectedModel: 'gemini-3.1-flash-image', resolution: '4K', aspectRatio: '16:9' } },
  { alias: 'nbp', nodeType: 'generateImage', label: 'Image · Nano Banana Pro',
    description: 'Gemini 3 Pro Image — best quality',
    dataOverride: { selectedModel: 'gemini-3-pro-image', resolution: '4K', aspectRatio: '16:9' } },
  { alias: 'nb2lite', nodeType: 'generateImage', label: 'Image · Nano Banana 2 Lite',
    description: 'Gemini 3.1 Flash-Lite Image — fastest/cheapest',
    dataOverride: { selectedModel: 'gemini-3.1-flash-lite-image', resolution: '1K', aspectRatio: '16:9' } },
  { alias: 'nblite', nodeType: 'generateImage', label: 'Image · Nano Banana 2 Lite',
    description: 'Gemini 3.1 Flash-Lite Image — fastest/cheapest',
    dataOverride: { selectedModel: 'gemini-3.1-flash-lite-image', resolution: '1K', aspectRatio: '16:9' } },
  { alias: 'gpt', nodeType: 'generateImage', label: 'Image · GPT Image 2',
    description: 'OpenAI gpt-image-2 — multi-ref edit, text fidelity',
    dataOverride: { selectedModel: 'gpt-image-2', resolution: 'Draft', aspectRatio: '16:9' } },
  { alias: 'gpt2', nodeType: 'generateImage', label: 'Image · GPT Image 2',
    description: 'OpenAI gpt-image-2',
    dataOverride: { selectedModel: 'gpt-image-2', resolution: 'Draft', aspectRatio: '16:9' } },
  { alias: 'flux', nodeType: 'generateImage', label: 'Image · Flux 2 Klein 9B',
    description: 'BFL Flux 2 Klein 9B',
    dataOverride: { selectedModel: 'flux-2-klein-9b', aspectRatio: '16:9' } },
  { alias: 'flux4', nodeType: 'generateImage', label: 'Image · Flux 2 Klein 4B',
    description: 'BFL Flux 2 Klein 4B — lighter, faster',
    dataOverride: { selectedModel: 'flux-2-klein-4b', aspectRatio: '16:9' } },
  { alias: 'imagen', nodeType: 'generateImage', label: 'Image · Imagen 4 Ultra',
    description: 'Google Imagen 4 Ultra (sunset 2026-06-24)',
    dataOverride: { selectedModel: 'imagen-4.0-ultra-generate-001', aspectRatio: '16:9' } },
  { alias: 'imagenf', nodeType: 'generateImage', label: 'Image · Imagen 4 Fast',
    description: 'Google Imagen 4 Fast (sunset 2026-06-24)',
    dataOverride: { selectedModel: 'imagen-4.0-fast-generate-001', aspectRatio: '16:9' } },
  { alias: 'atlas', nodeType: 'generateImage', label: 'Image · Flux 2 Pro (Atlas)',
    description: 'Atlas Cloud Flux 2 Pro 32B',
    dataOverride: { selectedModel: 'atlas-flux-2-pro', aspectRatio: '16:9' } },

  // ── LLM (llm) ──────────────────────────────────────────────────────────
  { alias: 'opus', nodeType: 'llm', label: 'LLM · Opus 4.8 (CLI)',
    description: 'Claude Opus 4.8 via local CLI — subscription auth',
    dataOverride: { selectedModel: 'cli-claude-opus-4-8' } },
  { alias: 'opus48', nodeType: 'llm', label: 'LLM · Opus 4.8 (CLI)',
    description: 'Claude Opus 4.8 via local CLI',
    dataOverride: { selectedModel: 'cli-claude-opus-4-8' } },
  { alias: 'opus47', nodeType: 'llm', label: 'LLM · Opus 4.7 (CLI)',
    description: 'Claude Opus 4.7 via local CLI',
    dataOverride: { selectedModel: 'cli-claude-opus-4-7' } },
  { alias: 'opus46', nodeType: 'llm', label: 'LLM · Opus 4.6 (CLI)',
    description: 'Claude Opus 4.6 via local CLI',
    dataOverride: { selectedModel: 'cli-claude-opus-4-6' } },
  { alias: 'sonnet', nodeType: 'llm', label: 'LLM · Sonnet 5 (CLI)',
    description: 'Claude Sonnet 5 via local CLI',
    dataOverride: { selectedModel: 'cli-claude-sonnet-5' } },
  { alias: 'sonnet46', nodeType: 'llm', label: 'LLM · Sonnet 4.6 (CLI)',
    description: 'Claude Sonnet 4.6 via local CLI',
    dataOverride: { selectedModel: 'cli-claude-sonnet-4-6' } },
  { alias: 'flash', nodeType: 'llm', label: 'LLM · Gemini 3.1 Flash-Lite',
    description: 'Ultra fast & cheap',
    dataOverride: { selectedModel: 'gemini-3.1-flash-lite' } },
  { alias: 'flashthk', nodeType: 'llm', label: 'LLM · Flash-Lite Thinking',
    description: 'Flash-Lite with thinking high',
    dataOverride: { selectedModel: 'gemini-3.1-flash-lite:thinking' } },
  { alias: 'pro', nodeType: 'llm', label: 'LLM · Gemini 3.1 Pro',
    description: 'Latest, thinking always on',
    dataOverride: { selectedModel: 'gemini-3.1-pro-preview' } },
  { alias: 'gflash', nodeType: 'llm', label: 'LLM · Gemini 3 Flash',
    description: '1M context, balanced',
    dataOverride: { selectedModel: 'gemini-3-flash-preview' } },

  // ── Video (generateVideo) ──────────────────────────────────────────────
  { alias: 'kling', nodeType: 'generateVideo', label: 'Video · Kling 3.0 Omni Std (Atlas)',
    description: 'Atlas Kling 3.0 Omni Std',
    dataOverride: { selectedModel: 'atlas-kling-omni-std', aspectRatio: '16:9' } },
  { alias: 'klingpro', nodeType: 'generateVideo', label: 'Video · Kling 3.0 Omni Pro (Atlas)',
    description: 'Atlas Kling 3.0 Omni Pro',
    dataOverride: { selectedModel: 'atlas-kling-v3-pro', aspectRatio: '16:9' } },
  { alias: 'klingmc', nodeType: 'generateVideo', label: 'Video · Kling Motion Control',
    description: 'Atlas Kling Motion Control',
    dataOverride: { selectedModel: 'atlas-kling-motion-control', aspectRatio: '16:9' } },
  { alias: 'seed', nodeType: 'generateVideo', label: 'Video · Seedance 2.0 (Atlas)',
    description: 'Atlas Seedance 2.0',
    dataOverride: { selectedModel: 'atlas-seedance-2.0', aspectRatio: '21:9' } },
  { alias: 'seedfast', nodeType: 'generateVideo', label: 'Video · Seedance 2.0 Fast (Atlas)',
    description: 'Atlas Seedance 2.0 Fast',
    dataOverride: { selectedModel: 'atlas-seedance-2.0-fast', aspectRatio: '21:9' } },
  { alias: 'veo', nodeType: 'generateVideo', label: 'Video · Veo 3.1 (Vertex)',
    description: 'Google Veo 3.1',
    dataOverride: { selectedModel: 'vertex-veo-3.1', aspectRatio: '16:9' } },
  { alias: 'veofast', nodeType: 'generateVideo', label: 'Video · Veo 3.1 Fast (Vertex)',
    description: 'Google Veo 3.1 Fast',
    dataOverride: { selectedModel: 'vertex-veo-3.1-fast', aspectRatio: '16:9' } },
  { alias: 'omni', nodeType: 'generateVideo', label: 'Video · Gemini Omni Flash',
    description: 'Google Gemini Omni Flash — 720p, 3-10s',
    dataOverride: { selectedModel: 'gemini-omni-flash', aspectRatio: '16:9' } },
  { alias: 'falkling', nodeType: 'generateVideo', label: 'Video · Kling 3.0 Omni Std (fal)',
    description: 'fal.ai Kling 3.0 Omni Std',
    dataOverride: { selectedModel: 'fal-kling-v3-std', aspectRatio: '16:9' } },
  { alias: 'falklingpro', nodeType: 'generateVideo', label: 'Video · Kling 3.0 Omni Pro (fal)',
    description: 'fal.ai Kling 3.0 Omni Pro',
    dataOverride: { selectedModel: 'fal-kling-v3-pro', aspectRatio: '16:9' } },
  { alias: 'falseed', nodeType: 'generateVideo', label: 'Video · Seedance 2.0 (fal)',
    description: 'fal.ai Seedance 2.0',
    dataOverride: { selectedModel: 'fal-seedance-2.0', aspectRatio: '21:9' } },
  { alias: 'piakling', nodeType: 'generateVideo', label: 'Video · Kling 3.0 Omni (PiAPI)',
    description: 'PiAPI Kling 3.0 Omni',
    dataOverride: { selectedModel: 'kling-3.0-omni', aspectRatio: '16:9' } },
  { alias: 'piaseed', nodeType: 'generateVideo', label: 'Video · Seedance 2.0 (PiAPI)',
    description: 'PiAPI Seedance 2.0',
    dataOverride: { selectedModel: 'seedance-2.0', aspectRatio: '21:9' } },

  // ── Utility (colorCorrection) ──────────────────────────────────────────
  { alias: 'cc', nodeType: 'colorCorrection', label: 'Color Correction',
    description: 'Adjust brightness, contrast, saturation (client-side canvas)',
    dataOverride: {} },
  { alias: 'color', nodeType: 'colorCorrection', label: 'Color Correction',
    description: 'Adjust brightness, contrast, saturation',
    dataOverride: {} },
]

/** Find all aliases that prefix-match the query (case-insensitive). Exact
 *  matches sort first. */
export function matchAliases(query: string): QuickAlias[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const exact: QuickAlias[] = []
  const prefix: QuickAlias[] = []
  for (const a of QUICK_ALIASES) {
    if (a.alias === q) exact.push(a)
    else if (a.alias.startsWith(q)) prefix.push(a)
  }
  return [...exact, ...prefix]
}

/** Synthesize a manifest by merging the alias's dataOverride into the base
 *  manifest's defaultData. The base entry is found by `nodeType`. Returns the
 *  base entry unchanged if alias.nodeType is unknown (caller handles fallback). */
export function applyAlias(base: NodeManifest, alias: QuickAlias): NodeManifest {
  return {
    ...base,
    defaultData: { ...base.defaultData, ...alias.dataOverride },
  }
}
