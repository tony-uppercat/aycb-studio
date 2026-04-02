import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('image-merge manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('imageMerge')
    expect(manifest.label).toBe('Image Merge')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'image', handleId: 'image-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'image', handleId: 'image-out' })
  })

  it('has defaultData with layout, gap, background', () => {
    expect(manifest.defaultData).toEqual({ layout: 'grid', gap: 4, background: '#000000' })
  })
})
