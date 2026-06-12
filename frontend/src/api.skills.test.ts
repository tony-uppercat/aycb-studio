import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './api'

describe('api.listSkills', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ skills: [{ name: 'caveman', description: 'd', source: 's' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
  })
  it('fetches the skills list', async () => {
    const r = await api.listSkills()
    expect(r.skills[0].name).toBe('caveman')
  })
})
