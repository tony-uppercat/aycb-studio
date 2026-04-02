import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('generate-video manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('generateVideo')
    expect(manifest.label).toBe('Generate Video')
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
    expect(manifest.defaultData.selectedModel).toBe('seedance-1.0-lite')
  })
})
