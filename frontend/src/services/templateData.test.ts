import { describe, it, expect } from 'vitest'
import { stripNodeData, keepNodeContent } from './templateData'

describe('stripNodeData (Clean template)', () => {
  it('preserves parser UI toggles (pinsCollapsed, previewCollapsed, textCollapsed)', () => {
    // The original bug: these toggles are user settings, not content. They
    // were stripped by an out-of-date allowlist. The denylist keeps them.
    const out = stripNodeData({
      text: 'some upstream text',
      pinsCollapsed: true,
      previewCollapsed: true,
      textCollapsed: true,
      excludedKeys: ['foo'],
      outputLimit: 10,
    })
    expect(out.pinsCollapsed).toBe(true)
    expect(out.previewCollapsed).toBe(true)
    expect(out.textCollapsed).toBe(true)
    expect(out.excludedKeys).toEqual(['foo'])
    expect(out.outputLimit).toBe(10)
    // Content stripped
    expect(out.text).toBeUndefined()
  })

  it('preserves parser config (parseMode, outputFormat, flatten, maxDepth, overrides, outputOverride)', () => {
    const out = stripNodeData({
      parseMode: 'json',
      outputFormat: 'kv',
      flatten: true,
      maxDepth: 3,
      overrides: { foo: 'bar' },
      outputOverride: 'manual edit',
      excludedSections: ['meta'],
      outputMode: 'template',
    })
    expect(out.parseMode).toBe('json')
    expect(out.outputFormat).toBe('kv')
    expect(out.flatten).toBe(true)
    expect(out.maxDepth).toBe(3)
    expect(out.overrides).toEqual({ foo: 'bar' })
    expect(out.outputOverride).toBe('manual edit')
    expect(out.excludedSections).toEqual(['meta'])
    expect(out.outputMode).toBe('template')
  })

  it('strips content (text, prompt, outputText, result, imageB64)', () => {
    const out = stripNodeData({
      text: 'a', prompt: 'b', outputText: 'c', result: 'd', imageB64: 'e',
    })
    expect(out).toEqual({})
  })

  it('strips media references (mediaId, historyIds, outputMediaIds, frameIds)', () => {
    const out = stripNodeData({
      mediaId: 'abc', historyIds: ['x', 'y'],
      outputMediaIds: { 'image-out': 'z' },
      frameIds: ['f1'],
    })
    expect(out).toEqual({})
  })

  it('strips subnet boundary mediaId_* cache keys', () => {
    const out = stripNodeData({
      'mediaId_image-0': 'subnet-cached-id',
      'mediaId_image-1': 'another',
      selectedModel: 'gemini-3.1',
    })
    expect(out.selectedModel).toBe('gemini-3.1')
    expect(out['mediaId_image-0']).toBeUndefined()
    expect(out['mediaId_image-1']).toBeUndefined()
  })

  it('strips api keys and runtime status', () => {
    const out = stripNodeData({
      apiKey: 'secret', openaiApiKey: 'sk-...', bflApiKey: 'bfl-...',
      _stop: true, error: 'oops', progress: 0.5, batchProgress: 2,
      lastCost: 0.034, status: 'pending', requestId: 'req-1',
    })
    expect(out).toEqual({})
  })

  it('strips File instances and blob: URLs', () => {
    const out = stripNodeData({
      file: new File(['x'], 'x.png'),
      preview: 'blob:http://localhost/abc',
      label: 'My Group',
    })
    expect(out).toEqual({ label: 'My Group' })
  })

  it('preserves model + ar + custom name + bypass + group fields', () => {
    const out = stripNodeData({
      selectedModel: 'gemini-3.1', aspectRatio: '16:9', resolution: '2K',
      _customName: 'Hero Image', _bypassed: true,
      label: 'Group A', collapsed: false, color: '#F52776',
    })
    expect(out).toEqual({
      selectedModel: 'gemini-3.1', aspectRatio: '16:9', resolution: '2K',
      _customName: 'Hero Image', _bypassed: true,
      label: 'Group A', collapsed: false, color: '#F52776',
    })
  })
})

describe('keepNodeContent (Content template)', () => {
  it('keeps everything except File and blob:', () => {
    const out = keepNodeContent({
      text: 'kept', mediaId: 'kept', pinsCollapsed: true,
      file: new File(['x'], 'x.png'),
      preview: 'blob:http://localhost/abc',
    })
    expect(out).toEqual({ text: 'kept', mediaId: 'kept', pinsCollapsed: true })
  })
})
