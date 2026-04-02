import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('image-compare manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('imageCompare')
    expect(manifest.label).toBe('Image Compare')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(2)
    expect(manifest.inputs[0]).toEqual({ type: 'image', handleId: 'image-0' })
    expect(manifest.inputs[1]).toEqual({ type: 'image', handleId: 'image-1' })
    expect(manifest.outputs).toHaveLength(0)
  })

  it('has empty defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
