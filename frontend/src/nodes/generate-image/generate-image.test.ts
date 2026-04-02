import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('generate-image manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('generateImage')
    expect(manifest.label).toBe('Generate Image')
    expect(manifest.category).toBe('media-model')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(2)
    expect(manifest.inputs[0]).toEqual({ type: 'prompt', handleId: 'prompt-in' })
    expect(manifest.inputs[1]).toEqual({ type: 'image', handleId: 'image-0' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'image', handleId: 'image-out' })
  })

  it('has defaultData with model', () => {
    expect(manifest.defaultData.selectedModel).toBe('gemini-3.1-flash-image-preview')
    expect(manifest.defaultData.prompt).toBe('')
  })
})
