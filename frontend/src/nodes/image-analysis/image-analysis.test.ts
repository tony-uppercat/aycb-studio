import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('image-analysis manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('imageAnalysis')
    expect(manifest.label).toBe('Image Analysis')
    expect(manifest.category).toBe('llm')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(2)
    expect(manifest.inputs[0]).toEqual({ type: 'image', handleId: 'image-in' })
    expect(manifest.inputs[1]).toEqual({ type: 'prompt', handleId: 'prompt-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has defaultData with prompt', () => {
    expect(manifest.defaultData.prompt).toBe('')
  })
})
