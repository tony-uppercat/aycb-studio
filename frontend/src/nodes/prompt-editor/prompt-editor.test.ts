import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('prompt-editor manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('textInput')
    expect(manifest.label).toBe('Text Input')
    expect(manifest.category).toBe('input')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'text', handleId: 'text-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'prompt', handleId: 'text-out' })
  })

  it('has defaultData', () => {
    expect(manifest.defaultData).toEqual({ outputText: '' })
  })
})
