export interface BracketEntry {
  index: number
  content: string
  start: number   // position of '[' in original text
  end: number     // exclusive end: position after ']' in original text
}

export interface UniqueEntry {
  name: string      // bracket content, e.g. "subject_01"
  count: number     // occurrences in the text
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

/** Deduplicate brackets by content name, preserving first-seen order. */
export function getUniqueNames(brackets: BracketEntry[]): UniqueEntry[] {
  const counts = new Map<string, number>()
  for (const b of brackets) {
    counts.set(b.content, (counts.get(b.content) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
}

/** Find all top-level {...} blocks with their positions. */
export function findJsonBlocks(text: string): { start: number; end: number }[] {
  const blocks: { start: number; end: number }[] = []
  let depth = 0
  let blockStart = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' && depth === 0) blockStart = i
    if (text[i] === '{') depth++
    if (text[i] === '}') {
      depth--
      if (depth === 0 && blockStart >= 0) {
        blocks.push({ start: blockStart, end: i + 1 })
        blockStart = -1
      }
    }
  }
  return blocks
}

/**
 * Extract variable definitions from JSON blocks with [name] keys.
 * Looks for keys matching "[name]" pattern and extracts the "class" field.
 */
export function extractJsonDefinitions(text: string): Record<string, string> {
  const defs: Record<string, string> = {}
  const blocks = findJsonBlocks(text)
  for (const block of blocks) {
    try {
      const obj = JSON.parse(text.slice(block.start, block.end))
      for (const [key, val] of Object.entries(obj)) {
        const m = key.match(/^\[(.+)\]$/)
        if (m && val && typeof val === 'object' && 'class' in (val as Record<string, unknown>)) {
          defs[m[1]] = String((val as Record<string, unknown>).class)
        }
      }
    } catch { /* not valid JSON block — skip */ }
  }
  return defs
}

/** Find the innermost {...} block enclosing a given position. */
export function findEnclosingBlock(text: string, pos: number): { start: number; end: number } | null {
  // Walk backward to find nearest unmatched {
  let depth = 0
  let blockStart = -1
  for (let i = pos; i >= 0; i--) {
    if (text[i] === '}') depth++
    if (text[i] === '{') {
      if (depth === 0) { blockStart = i; break }
      depth--
    }
  }
  if (blockStart === -1) return null
  // Walk forward from blockStart to find the matching }
  depth = 0
  for (let i = blockStart; i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}') {
      depth--
      if (depth === 0) return { start: blockStart, end: i + 1 }
    }
  }
  return null
}

/**
 * Rebuild text replacing [name] brackets with resolved values (strips brackets).
 * Excluded names cause their innermost containing {...} block to be removed,
 * including trailing comma/whitespace for clean array output.
 */
export function rebuildTemplate(
  original: string,
  brackets: BracketEntry[],
  values: Record<string, string>,
  excluded?: Set<string>,
): string {
  if (brackets.length === 0) return original

  // Pass 1: Find innermost {} blocks to remove for each excluded bracket
  let text = original
  if (excluded && excluded.size > 0) {
    const blocksToRemove: { start: number; end: number }[] = []
    const allBrackets = extractBrackets(text)
    for (const b of allBrackets) {
      if (!excluded.has(b.content)) continue
      const block = findEnclosingBlock(text, b.start)
      if (block && !blocksToRemove.some(x => x.start === block.start)) {
        blocksToRemove.push(block)
      }
    }
    // Remove in reverse order to preserve positions
    blocksToRemove.sort((a, b) => b.start - a.start)
    for (const block of blocksToRemove) {
      let removeStart = block.start
      let removeEnd = block.end
      // Eat trailing comma + whitespace (for arrays)
      let after = removeEnd
      while (after < text.length && /\s/.test(text[after])) after++
      if (after < text.length && text[after] === ',') {
        removeEnd = after + 1
      } else {
        // No trailing comma — eat leading comma + whitespace
        let before = removeStart - 1
        while (before >= 0 && /\s/.test(text[before])) before--
        if (before >= 0 && text[before] === ',') removeStart = before
      }
      // Eat trailing newlines
      while (removeEnd < text.length && (text[removeEnd] === '\n' || text[removeEnd] === '\r' || text[removeEnd] === ' ')) removeEnd++
      text = text.slice(0, removeStart) + text.slice(removeEnd)
    }
  }

  // Pass 2: Substitute remaining brackets
  const remaining = extractBrackets(text)
  if (remaining.length === 0) return text
  let result = ''
  let cursor = 0
  for (const b of remaining) {
    result += text.slice(cursor, b.start)
    if (b.content in values) {
      result += values[b.content]
    } else {
      result += `[${b.content}]`
    }
    cursor = b.end
  }
  result += text.slice(cursor)
  return result
}
