import { describe, it, expect, beforeEach } from 'vitest'
import { pruneStemMap, MAX_STEMS, registerBridgeStem, getStemForMedia } from './reviewStatus'
import { STORAGE_KEYS } from '../storage/keys'

describe('pruneStemMap', () => {
  it('returns map unchanged when under cap', () => {
    const map = { 'media-2-a': 's2', 'media-1-a': 's1' }
    expect(pruneStemMap(map, 5)).toEqual(map)
  })

  it('drops oldest entries (by timestamp in mediaId) when over cap', () => {
    const map: Record<string, string> = {}
    for (let i = 0; i < 10; i++) map[`media-${1000 + i}-x`] = `stem${i}`
    const pruned = pruneStemMap(map, 4)
    expect(Object.keys(pruned)).toHaveLength(4)
    expect(pruned['media-1009-x']).toBe('stem9')
    expect(pruned['media-1006-x']).toBe('stem6')
    expect(pruned['media-1000-x']).toBeUndefined()
  })
})

describe('registerBridgeStem — capped persistence', () => {
  beforeEach(() => localStorage.clear())

  it('persists and reads back a stem', () => {
    registerBridgeStem('media-1-a', 'generated_1')
    expect(getStemForMedia('media-1-a')).toBe('generated_1')
  })

  it('never grows the stored map past MAX_STEMS', () => {
    const seed: Record<string, string> = {}
    for (let i = 0; i < MAX_STEMS; i++) seed[`media-${1000 + i}-x`] = 's'
    localStorage.setItem(STORAGE_KEYS.BRIDGE_STEMS, JSON.stringify(seed))
    registerBridgeStem(`media-${1000 + MAX_STEMS}-x`, 'new')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.BRIDGE_STEMS)!)
    expect(Object.keys(stored).length).toBeLessThanOrEqual(MAX_STEMS)
    expect(stored[`media-${1000 + MAX_STEMS}-x`]).toBe('new') // newest kept
    expect(stored['media-1000-x']).toBeUndefined() // oldest dropped
  })
})
