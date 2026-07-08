import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { saveUserTemplate, updateUserTemplate, getUserTemplates, USER_TEMPLATES_KEY } from './presets'

const tpl = (id: string) => ({
  id, name: id, description: '', nodes: [], edges: [], createdAt: 'now',
})

describe('user templates — quota failure must be loud, not silent', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('saveUserTemplate returns true on success', () => {
    expect(saveUserTemplate(tpl('t1'))).toBe(true)
    expect(getUserTemplates()).toHaveLength(1)
  })

  it('saveUserTemplate returns false and warns when localStorage is full', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(saveUserTemplate(tpl('t1'))).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('updateUserTemplate returns false and warns when localStorage is full', () => {
    saveUserTemplate(tpl('t1'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(updateUserTemplate('t1', { name: 'renamed' })).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('updateUserTemplate returns false for unknown id', () => {
    expect(updateUserTemplate('nope', { name: 'x' })).toBe(false)
  })
})

// USER_TEMPLATES_KEY re-export sanity (used by cleanup script docs)
it('templates key is the registry key', () => {
  expect(USER_TEMPLATES_KEY).toBe('aycb_user_templates')
})
