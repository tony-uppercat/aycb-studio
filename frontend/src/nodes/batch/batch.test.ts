import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('batch manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('batch')
    expect(manifest.label).toBe('Batch')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'media', handleId: 'media-in' })
    expect(manifest.outputs).toHaveLength(2)
    expect(manifest.outputs[0]).toEqual({ type: 'media', handleId: 'media-out' })
    expect(manifest.outputs[1]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has empty defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
