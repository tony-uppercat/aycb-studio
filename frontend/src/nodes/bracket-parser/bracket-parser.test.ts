import { describe, it, expect } from 'vitest'
import { extractBrackets, rebuildTemplate } from './bracketParserUtils'
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

describe('rebuildTemplate', () => {
  it('rebuilds with no overrides', () => {
    const brackets = extractBrackets('The [dragon] flies')
    const result = rebuildTemplate('The [dragon] flies', brackets, {})
    expect(result).toBe('The [dragon] flies')
  })

  it('applies overrides', () => {
    const brackets = extractBrackets('The [dragon] flew over the [castle]')
    const result = rebuildTemplate(
      'The [dragon] flew over the [castle]',
      brackets,
      { '0': 'phoenix' }
    )
    expect(result).toBe('The [phoenix] flew over the [castle]')
  })

  it('applies multiple overrides', () => {
    const brackets = extractBrackets('[a] and [b]')
    const result = rebuildTemplate('[a] and [b]', brackets, { '0': 'x', '1': 'y' })
    expect(result).toBe('[x] and [y]')
  })

  it('handles excluded indices (keeps original)', () => {
    const brackets = extractBrackets('[a] and [b]')
    const excluded = new Set(['0'])
    const result = rebuildTemplate('[a] and [b]', brackets, { '1': 'y' }, excluded)
    expect(result).toBe('[a] and [y]')
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
