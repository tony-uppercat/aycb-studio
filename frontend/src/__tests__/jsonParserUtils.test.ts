import { describe, it, expect } from 'vitest'
import { resolvePath, valueToString, parseJsonInput } from '../utils/jsonParserUtils'

describe('resolvePath', () => {
  const obj = { a: { b: [10, 20, { c: 'deep' }] }, x: 'hello' }

  it('returns root for empty path', () => {
    expect(resolvePath(obj, '')).toBe(obj)
  })

  it('resolves dot-notation', () => {
    expect(resolvePath(obj, 'x')).toBe('hello')
    expect(resolvePath(obj, 'a.b')).toEqual([10, 20, { c: 'deep' }])
  })

  it('resolves bracket notation', () => {
    expect(resolvePath(obj, 'a.b[0]')).toBe(10)
    expect(resolvePath(obj, 'a.b[2].c')).toBe('deep')
  })

  it('returns undefined for missing paths', () => {
    expect(resolvePath(obj, 'missing')).toBeUndefined()
    expect(resolvePath(obj, 'a.b[99]')).toBeUndefined()
    expect(resolvePath(obj, 'a.b.c.d')).toBeUndefined()
  })

  it('handles null/undefined input', () => {
    expect(resolvePath(null, 'a')).toBeUndefined()
    expect(resolvePath(undefined, 'a')).toBeUndefined()
  })

  it('resolves numeric string keys on objects', () => {
    expect(resolvePath({ '0': 'zero' }, '0')).toBe('zero')
  })
})

describe('valueToString', () => {
  it('converts primitives', () => {
    expect(valueToString('hello')).toBe('hello')
    expect(valueToString(42)).toBe('42')
    expect(valueToString(true)).toBe('true')
    expect(valueToString(null)).toBe('null')
    expect(valueToString(undefined)).toBe('')
  })

  it('converts objects to formatted JSON', () => {
    expect(valueToString({ a: 1 })).toBe('{\n  "a": 1\n}')
  })
})

describe('parseJsonInput', () => {
  it('parses valid JSON and extracts by path', () => {
    const r = parseJsonInput('{"key":"val"}', 'key')
    expect(r).toEqual({ ok: true, value: 'val', display: 'val' })
  })

  it('returns full object for empty path', () => {
    const r = parseJsonInput('{"a":1}', '')
    expect(r).toEqual({ ok: true, value: { a: 1 }, display: '{\n  "a": 1\n}' })
  })

  it('passes through plain text as-is when no JSON found', () => {
    const r = parseJsonInput('not json', '')
    expect(r).toEqual({ ok: true, value: 'not json', display: 'not json' })
  })

  it('returns error for missing path', () => {
    const r = parseJsonInput('{"a":1}', 'b')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('not found')
  })

  it('handles empty input', () => {
    const r = parseJsonInput('', 'a')
    expect(r).toEqual({ ok: true, value: undefined, display: '' })
  })
})
