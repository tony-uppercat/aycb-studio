import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('metaprompt manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('metaprompt')
    expect(manifest.label).toBe('Metaprompt')
    expect(manifest.category).toBe('llm')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(3)
    expect(manifest.inputs[0]).toEqual({ type: 'image', handleId: 'image-0' })
    expect(manifest.inputs[1]).toEqual({ type: 'image', handleId: 'image-1' })
    expect(manifest.inputs[2]).toEqual({ type: 'prompt', handleId: 'prompt-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has empty defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
