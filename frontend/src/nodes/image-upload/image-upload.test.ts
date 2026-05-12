import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('image-upload manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('imageUpload')
    expect(manifest.label).toBe('Image')
    expect(manifest.category).toBe('input')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'image', handleId: 'image-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'image', handleId: 'image-out' })
  })

  it('has empty defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
