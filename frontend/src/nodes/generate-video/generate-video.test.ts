import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'
import { VIDEO_MODELS } from './useGenerateVideo'

describe('generate-video manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('generateVideo')
    expect(manifest.label).toBe('Video')
    expect(manifest.category).toBe('media-model')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(2)
    expect(manifest.inputs[0]).toEqual({ type: 'prompt', handleId: 'prompt-in' })
    expect(manifest.inputs[1]).toEqual({ type: 'image', handleId: 'image-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'video', handleId: 'video-out' })
  })

  it('has defaultData with selectedModel', () => {
    expect(manifest.defaultData.selectedModel).toBe('atlas-seedance-2.0')
  })
})

describe('VIDEO_MODELS_FALLBACK', () => {
  it('includes the Gemini Omni Flash row', () => {
    const omni = VIDEO_MODELS.find(m => m.id === 'gemini-omni-flash')
    expect(omni).toBeDefined()
    expect(omni?.provider).toBe('gemini')
    expect(omni?.name).toBe('Gemini Omni Flash')
    expect(omni?.cost).toBe(0.10)
    expect(omni?.ratios).toEqual(['16:9', '9:16'])
    expect(omni?.qualities).toEqual(['720p'])
    expect(omni?.minDuration).toBe(3)
    expect(omni?.maxDuration).toBe(10)
  })
})
