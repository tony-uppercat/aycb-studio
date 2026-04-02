export function resolvePath(obj: unknown, path: string): unknown {
  if (!path.trim()) return obj
  const keys = path
    .replace(/\[(\w+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cur: unknown = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

export function valueToString(val: unknown): string {
  if (val === undefined) return ''
  if (val === null) return 'null'
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  return JSON.stringify(val, null, 2)
}

export type ParseResult =
  | { ok: true; value: unknown; display: string }
  | { ok: false; error: string }

/** Try to extract a JSON object or array from text that may contain surrounding prose. */
function extractJson(text: string): string | null {
  // Try the whole string first
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed

  // Look for ```json ... ``` code blocks
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) return codeBlock[1].trim()

  // Find outermost { ... } or [ ... ]
  for (const open of ['{', '[']) {
    const close = open === '{' ? '}' : ']'
    const start = text.indexOf(open)
    if (start === -1) continue
    let depth = 0
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++
      else if (text[i] === close) depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function parseJsonInput(input: string, path: string): ParseResult {
  if (!input.trim()) return { ok: true, value: undefined, display: '' }

  // Try direct parse first
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    // Try extracting JSON from surrounding text
    const extracted = extractJson(input)
    if (extracted) {
      try {
        parsed = JSON.parse(extracted)
      } catch {
        // Not JSON at all — pass through as plain text
        return { ok: true, value: input, display: input }
      }
    } else {
      // No JSON found — pass through as plain text (not an error)
      return { ok: true, value: input, display: input }
    }
  }

  const resolved = resolvePath(parsed, path)
  if (resolved === undefined && path.trim()) {
    return { ok: false, error: `Path "${path}" not found` }
  }
  return { ok: true, value: resolved, display: valueToString(resolved) }
}
