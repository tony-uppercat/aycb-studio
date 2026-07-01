import { describe, it, expect } from 'vitest'
import { matchAliases, applyAlias, QUICK_ALIASES } from './quickAliases'
import type { NodeManifest } from './_shared/types'

describe('matchAliases', () => {
  it('returns empty array for empty query', () => {
    expect(matchAliases('')).toEqual([])
    expect(matchAliases('   ')).toEqual([])
  })

  it('case-insensitive exact match comes first', () => {
    const result = matchAliases('GPT')
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].alias).toBe('gpt')
  })

  it('prefix match catches longer aliases', () => {
    const result = matchAliases('nb')
    const aliases = result.map(r => r.alias)
    expect(aliases).toContain('nb')
    expect(aliases).toContain('nb2')
    expect(aliases).toContain('nbp')
    // exact 'nb' first
    expect(result[0].alias).toBe('nb')
  })

  it('opus prefix returns all opus variants', () => {
    const aliases = matchAliases('opus').map(r => r.alias)
    expect(aliases).toEqual(expect.arrayContaining(['opus', 'opus48', 'opus47', 'opus46']))
  })

  it('typing a non-existent alias returns empty', () => {
    expect(matchAliases('xyzzy123')).toEqual([])
  })
})

describe('applyAlias', () => {
  const baseManifest: NodeManifest = {
    type: 'generateImage',
    label: 'Generate Image',
    icon: '✨',
    category: 'media-model',
    description: 'x',
    defaultData: { prompt: '', selectedModel: 'OLD', aspectRatio: '1:1' },
    inputs: [],
    outputs: [],
  }

  it('merges override into defaultData without mutating base', () => {
    const alias = QUICK_ALIASES.find(a => a.alias === 'gpt')!
    const synth = applyAlias(baseManifest, alias)
    expect(synth.defaultData.selectedModel).toBe('gpt-image-2')
    expect(synth.defaultData.resolution).toBe('Draft')
    // base remains unchanged
    expect(baseManifest.defaultData.selectedModel).toBe('OLD')
    expect(baseManifest.defaultData.resolution).toBeUndefined()
  })

  it('preserves type/inputs/outputs from base', () => {
    const alias = QUICK_ALIASES.find(a => a.alias === 'opus')!
    const synth = applyAlias(baseManifest, alias)
    expect(synth.type).toBe(baseManifest.type)
    expect(synth.inputs).toBe(baseManifest.inputs)
    expect(synth.outputs).toBe(baseManifest.outputs)
  })
})

describe('QUICK_ALIASES catalog', () => {
  it('has no duplicate (alias, nodeType) pairs', () => {
    const keys = QUICK_ALIASES.map(a => `${a.nodeType}:${a.alias}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every model-selecting entry has a non-empty selectedModel override', () => {
    // Utility nodes (e.g. colorCorrection) carry no model — exempt them.
    const MODEL_TYPES = new Set(['llm', 'generateImage', 'generateVideo'])
    for (const a of QUICK_ALIASES) {
      if (!MODEL_TYPES.has(a.nodeType)) continue
      expect(typeof a.dataOverride.selectedModel).toBe('string')
      expect((a.dataOverride.selectedModel as string).length).toBeGreaterThan(0)
    }
  })
})
