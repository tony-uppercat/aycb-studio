export interface UsageInfo {
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface AnalyzeImageResult {
  text: string
  json: Record<string, unknown>
  embedding_info: string
  preview_b64: string
  usage?: UsageInfo
}

export interface VideoFrame {
  b64: string
  label: string
}

export interface AnalyzeVideoResult {
  frames: VideoFrame[]
  text: string
  json_text: string
  embedding_info: string
  usage?: UsageInfo
}

export interface GenerateImageResult {
  image_b64: string | null
  status: string
  usage?: UsageInfo
  /** Bridge stem returned by backend (e.g. "generated_1774517737168"). Present when the backend handled the bridge. */
  bridge_stem?: string | null
}

export interface HistoryEntry {
  label: string
  prompt: string
}

// ── Canvas node data types ────────────────────────────────────────────────────

export interface ImageAnalysisNodeData {
  apiKey: string
  model: string
  doEmbed: boolean
  result?: { text: string; json: Record<string, unknown>; preview_b64: string }
  analysisHistory?: Array<{ text: string; json: Record<string, unknown>; preview_b64: string }>
  [key: string]: unknown
}

export interface VideoAnalysisNodeData {
  apiKey?: string
  model?: string
  selectedModel?: string
  doEmbed?: boolean
  nFrames?: number
  maxFrames?: number
  extractionMode?: 'sharpness' | 'cuts'
  cutSensitivity?: number
  outputText?: string
  text?: string
  jsonOut?: string
  frames?: VideoFrame[]
  result?: { text: string; json_text: string; frames: VideoFrame[] }
  _stop?: boolean
  [key: string]: unknown
}

export interface ResultViewerNodeData {
  text?: string
  json?: Record<string, unknown>
  json_text?: string
  [key: string]: unknown
}

export interface GenerateImageNodeData {
  apiKey: string
  model: string
  prompt?: string
  historyIds?: string[]   // mediaIds of all generated images
  [key: string]: unknown
}

export interface GenerateVideoNodeData {
  prompt?: string
  selectedModel?: string
  aspectRatio?: string
  duration?: number
  quality?: string
  requestId?: string
  videoUrl?: string
  status?: string
  mediaId?: string
  _stop?: boolean
  [key: string]: unknown
}

export interface GenerateVideoResult {
  request_id?: string
  status?: string
  url?: string
  error?: string
}

export interface PromptEditorNodeData {
  outputText?: string
  [key: string]: unknown
}

export interface ConsoleNodeData {
  [key: string]: unknown
}

export interface GroupNodeData {
  label: string
  collapsed: boolean
  color?: string
  [key: string]: unknown
}

export interface LLMNodeData extends Record<string, unknown> {
  text?: string
  prompt?: string
  outputText?: string
  selectedModel?: string
  mediaId?: string
  _stop?: boolean
  [key: `mediaId_${string}`]: string | undefined
}

export interface ImageUploadNodeData extends Record<string, unknown> {
  mediaId?: string
}

export interface VideoUploadNodeData extends Record<string, unknown> {
  mediaId?: string
  frameIds?: string[]
}

export interface JsonParserNodeData extends Record<string, unknown> {
  text?: string         // upstream input (read-only from node's perspective)
  prompt?: string       // upstream input alt key
  jsonPath?: string     // extraction path
  outputText?: string   // parsed result (propagated downstream)
  excludedKeys?: string[]  // keys to omit from output
  outputLimit?: number     // max items in output (0 = unlimited)
  parseMode?: 'json' | 'newline'  // parsing mode
  outputFormat?: 'values' | 'kv' | 'json'  // output format: values only, key: value, or filtered JSON
  flatten?: boolean  // flatten nested objects into dot-notation leaf keys
  excludedSections?: string[]  // top-level sections to exclude (flatten mode)
  overrides?: Record<string, string>  // inline value overrides per key
  maxDepth?: number  // max nesting depth to show (0 = unlimited)
  outputOverride?: string | null  // manual override of full output text
  pinsCollapsed?: boolean  // collapse dynamic output pins (show only main text-out)
}

export interface BracketParserNodeData extends Record<string, unknown> {
  text?: string
  outputText?: string
  output_mode?: 'items' | 'template'
  excluded_keys?: string[]
  output_limit?: number
  overrides?: Record<string, string>
  output_override?: string | null
  pins_collapsed?: boolean
}

export interface JsonParserBlendNodeData extends Record<string, unknown> {
  text?: string
  prompt?: string
  outputText?: string
  selections?: Record<string, number | null>
  excludedKeys?: string[]
  outputLimit?: number
  outputFormat?: 'json' | 'values' | 'kv'
  overrides?: Record<string, string>
}

export interface TextCombineNodeData extends Record<string, unknown> {
  outputText?: string
  separator?: string
}

export interface ImageFxNodeData extends Record<string, unknown> {
  mediaId?: string
  effect?: string        // 'canny' | 'none'
  cannyThreshold1?: number
  cannyThreshold2?: number
}

export interface SwitchNodeData extends Record<string, unknown> {
  outputText?: string
  activeChannel?: number  // 0-based index
}

export interface MetapromptNodeData extends Record<string, unknown> {
  outputText?: string
  text?: string
  selectedModel?: string
  _stop?: boolean
}
