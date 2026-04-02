import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('text-combine manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('textCombine')
    expect(manifest.label).toBe('Text Combine')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'text', handleId: 'text-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has defaultData with separator', () => {
    expect(manifest.defaultData.separator).toBe('\n')
  })
})
