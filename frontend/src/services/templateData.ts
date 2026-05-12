/**
 * Node-data filters used when saving canvas templates.
 *
 * `stripNodeData` is the "Clean" template variant: drops content (text,
 * generated outputs, media references) and runtime/sensitive fields, but
 * keeps every configuration setting — including UI toggles like
 * `pinsCollapsed`, `previewCollapsed`, `textCollapsed`. Uses a denylist
 * (STRIP_KEYS) instead of an allowlist so newly added settings are
 * preserved by default.
 *
 * `keepNodeContent` is the "Content" template variant: keeps everything
 * except File instances and blob: URLs (which can't be serialized).
 */

const STRIP_KEYS = new Set([
  // Inputs and generated content
  'text', 'prompt', 'outputText', 'output', 'response', 'result',
  'json', 'jsonOut', 'json_text', 'jsonText',
  'imageB64',
  // Media references (blobs live in IndexedDB; templates carry no blobs)
  'mediaId', 'historyIds', 'frameIds', 'currentMediaId',
  'outputMediaIds', 'outputPins',
  // Generation runtime
  'requestId', 'videoUrl', 'status', 'error', 'progress', 'batchProgress',
  'lastCost', '_stop',
  // Parser-derived (computed from text on load)
  'bracketPinValuesJson', 'includedEntries',
  // Frames and analysis history
  'frames', 'analysisHistory',
  // Sensitive — node-level api keys. The global SettingsContext keeps the
  // canonical copy; templates must never carry secrets.
  'apiKey', 'anthropicKey', 'openaiApiKey', 'recraftApiKey', 'hfApiKey',
  'bflApiKey', 'piApiKey', 'falApiKey', 'atlasApiKey', 'gcpProject',
])

export function stripNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (STRIP_KEYS.has(k)) continue
    if (k.startsWith('mediaId_')) continue       // subnet boundary cache
    if (v instanceof File) continue
    if (typeof v === 'string' && v.startsWith('blob:')) continue
    clean[k] = v
  }
  return clean
}

export function keepNodeContent(data: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (v instanceof File) continue
    if (typeof v === 'string' && v.startsWith('blob:')) continue
    clean[k] = v
  }
  return clean
}
