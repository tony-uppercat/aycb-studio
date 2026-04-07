import { describe, it, expect } from 'vitest'
import { extractBrackets, getUniqueNames, extractJsonDefinitions, findJsonBlocks, findEnclosingBlock, rebuildTemplate } from './bracketParserUtils'
import manifest from './node.manifest'

describe('extractBrackets', () => {
  it('extracts single bracket', () => {
    const result = extractBrackets('The [dragon] flies')
    expect(result).toEqual([
      { index: 0, content: 'dragon', start: 4, end: 12 },
    ])
  })

  it('extracts multiple brackets', () => {
    const result = extractBrackets('The [dragon] flew over the [ancient castle]')
    expect(result).toEqual([
      { index: 0, content: 'dragon', start: 4, end: 12 },
      { index: 1, content: 'ancient castle', start: 27, end: 43 },
    ])
  })

  it('returns empty array for no brackets', () => {
    expect(extractBrackets('no brackets here')).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(extractBrackets('')).toEqual([])
  })

  it('handles empty brackets', () => {
    const result = extractBrackets('before [] after')
    expect(result).toEqual([
      { index: 0, content: '', start: 7, end: 9 },
    ])
  })

  it('handles adjacent brackets', () => {
    const result = extractBrackets('[one][two]')
    expect(result).toEqual([
      { index: 0, content: 'one', start: 0, end: 5 },
      { index: 1, content: 'two', start: 5, end: 10 },
    ])
  })

  it('handles unclosed bracket (ignores it)', () => {
    const result = extractBrackets('open [ but [closed]')
    expect(result).toEqual([
      { index: 0, content: 'closed', start: 11, end: 19 },
    ])
  })

  it('handles brackets with special characters', () => {
    const result = extractBrackets('a [red, glowing dragon] roars')
    expect(result).toEqual([
      { index: 0, content: 'red, glowing dragon', start: 2, end: 23 },
    ])
  })
})

describe('getUniqueNames', () => {
  it('deduplicates by content', () => {
    const brackets = extractBrackets('[a] and [b] and [a] again')
    const result = getUniqueNames(brackets)
    expect(result).toEqual([
      { name: 'a', count: 2 },
      { name: 'b', count: 1 },
    ])
  })

  it('returns empty for no brackets', () => {
    expect(getUniqueNames([])).toEqual([])
  })

  it('preserves first-seen order', () => {
    const brackets = extractBrackets('[z] [a] [z] [b] [a]')
    const names = getUniqueNames(brackets).map(e => e.name)
    expect(names).toEqual(['z', 'a', 'b'])
  })
})

describe('findJsonBlocks', () => {
  it('finds top-level blocks', () => {
    const text = '{"a":1}\n{"b":2}'
    const blocks = findJsonBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(text.slice(blocks[0].start, blocks[0].end)).toBe('{"a":1}')
    expect(text.slice(blocks[1].start, blocks[1].end)).toBe('{"b":2}')
  })

  it('handles nested braces', () => {
    const text = '{"a":{"b":1}}'
    const blocks = findJsonBlocks(text)
    expect(blocks).toHaveLength(1)
  })

  it('returns empty for no blocks', () => {
    expect(findJsonBlocks('no blocks')).toEqual([])
  })
})

describe('findEnclosingBlock', () => {
  it('finds innermost block around position', () => {
    const text = '{"arr": [{"x": 1}, {"x": 2}]}'
    // Position 15 is inside {"x": 1}
    const block = findEnclosingBlock(text, 15)
    expect(block).not.toBeNull()
    expect(text.slice(block!.start, block!.end)).toBe('{"x": 1}')
  })

  it('returns null when no enclosing block', () => {
    expect(findEnclosingBlock('no blocks', 3)).toBeNull()
  })
})

describe('extractJsonDefinitions', () => {
  it('extracts class from [name] keys', () => {
    const json = '{"[subject_01]": {"class": "arch bridge", "role": "primary"}}'
    const defs = extractJsonDefinitions(json)
    expect(defs).toEqual({ subject_01: 'arch bridge' })
  })

  it('extracts multiple definitions', () => {
    const json = `{
      "[subject_01]": {"class": "bridge", "role": "primary"},
      "[location_01]": {"class": "frozen pond", "role": "surface"}
    }`
    const defs = extractJsonDefinitions(json)
    expect(defs).toEqual({ subject_01: 'bridge', location_01: 'frozen pond' })
  })

  it('ignores non-bracket keys', () => {
    const json = '{"shot_type": "wide", "[subject_01]": {"class": "bridge", "role": "x"}}'
    const defs = extractJsonDefinitions(json)
    expect(defs).toEqual({ subject_01: 'bridge' })
  })

  it('returns empty for no definitions', () => {
    expect(extractJsonDefinitions('no json here')).toEqual({})
  })

  it('returns empty for invalid JSON', () => {
    expect(extractJsonDefinitions('{broken')).toEqual({})
  })

  it('handles multiple JSON blocks', () => {
    const text = `{"[a]": {"class": "cat", "role": "subject"}}
{"lens": "85mm", "entity": "[a]"}`
    const defs = extractJsonDefinitions(text)
    expect(defs).toEqual({ a: 'cat' })
  })
})

describe('rebuildTemplate', () => {
  it('keeps original when no values provided', () => {
    const brackets = extractBrackets('The [dragon] flies')
    const result = rebuildTemplate('The [dragon] flies', brackets, {})
    expect(result).toBe('The [dragon] flies')
  })

  it('replaces by name and strips brackets', () => {
    const brackets = extractBrackets('The [dragon] flew over the [castle]')
    const result = rebuildTemplate(
      'The [dragon] flew over the [castle]',
      brackets,
      { dragon: 'phoenix' }
    )
    expect(result).toBe('The phoenix flew over the [castle]')
  })

  it('replaces all occurrences of same name', () => {
    const text = '[a] and [b] and [a] again'
    const brackets = extractBrackets(text)
    const result = rebuildTemplate(text, brackets, { a: 'X', b: 'Y' })
    expect(result).toBe('X and Y and X again')
  })

  it('excluded removes innermost {} block (nested)', () => {
    const text = '{"entities": [{"token": "[a]"}, {"token": "[b]"}]}'
    const brackets = extractBrackets(text)
    const excluded = new Set(['a'])
    const result = rebuildTemplate(text, brackets, { b: 'Y' }, excluded)
    expect(result).toBe('{"entities": [{"token": "Y"}]}')
  })

  it('excluded removes top-level block when not nested', () => {
    const text = '{"entity": "[a]"}\n{"entity": "[b]"}'
    const brackets = extractBrackets(text)
    const excluded = new Set(['a'])
    const result = rebuildTemplate(text, brackets, { b: 'Y' }, excluded)
    expect(result).toBe('{"entity": "Y"}')
  })

  it('excluded cleans up trailing commas in arrays', () => {
    const text = '[{"t": "[a]"}, {"t": "[b]"}, {"t": "[c]"}]'
    const brackets = extractBrackets(text)
    const excluded = new Set(['b'])
    const result = rebuildTemplate(text, brackets, { a: 'X', c: 'Z' }, excluded)
    expect(result).toBe('[{"t": "X"}, {"t": "Z"}]')
  })

  it('returns original text when no brackets', () => {
    const result = rebuildTemplate('no brackets', [], {})
    expect(result).toBe('no brackets')
  })
})

describe('bracket-parser manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('bracketParser')
    expect(manifest.label).toBe('Bracket Parser')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'text', handleId: 'text-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
