import { describe, it, expect } from 'vitest'
import { toSnakeCase } from './subnetUtils'

describe('toSnakeCase', () => {
  it('lowercases and collapses spaces to single underscore', () => {
    expect(toSnakeCase('My Input')).toBe('my_input')
    expect(toSnakeCase('Hello   World')).toBe('hello_world')
  })

  it('strips punctuation and symbols', () => {
    expect(toSnakeCase('foo-bar!baz')).toBe('foo_bar_baz')
  })

  it('trims leading and trailing underscores', () => {
    expect(toSnakeCase('  hello  ')).toBe('hello')
    expect(toSnakeCase('__foo__')).toBe('foo')
  })

  it('returns empty string for all-symbol input', () => {
    expect(toSnakeCase('!!!')).toBe('')
    expect(toSnakeCase('   ')).toBe('')
  })

  it('prefixes leading digit with underscore', () => {
    expect(toSnakeCase('9lives')).toBe('_9lives')
    expect(toSnakeCase('3d_view')).toBe('_3d_view')
  })

  it('preserves existing snake_case', () => {
    expect(toSnakeCase('already_snake')).toBe('already_snake')
  })
})
