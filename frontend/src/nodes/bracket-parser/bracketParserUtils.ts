export interface BracketEntry {
  index: number
  content: string
  start: number   // position of '[' in original text
  end: number     // exclusive end: position after ']' in original text
}

/**
 * Extract all first-level [bracketed] segments from text.
 * Ignores unclosed brackets. Does not handle nesting.
 */
export function extractBrackets(text: string): BracketEntry[] {
  const entries: BracketEntry[] = []
  const regex = /\[([^\[\]]*)\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    entries.push({
      index: entries.length,
      content: match[1],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return entries
}

/**
 * Rebuild the original text, replacing bracket contents with overrides.
 * Excluded brackets keep their original content.
 */
export function rebuildTemplate(
  original: string,
  brackets: BracketEntry[],
  overrides: Record<string, string>,
  excluded?: Set<string>,
): string {
  if (brackets.length === 0) return original
  let result = ''
  let cursor = 0
  for (const b of brackets) {
    result += original.slice(cursor, b.start)
    const key = String(b.index)
    const isExcluded = excluded?.has(key)
    const content = !isExcluded && key in overrides ? overrides[key] : b.content
    result += `[${content}]`
    cursor = b.end
  }
  result += original.slice(cursor)
  return result
}
