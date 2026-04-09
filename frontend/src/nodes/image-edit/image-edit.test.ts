import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('image-edit manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('imageEdit')
    expect(manifest.label).toBe('Image Edit')
    expect(manifest.category).toBe('media-model')
  })

  it('has image input and output', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0].type).toBe('image')
    expect(manifest.inputs[0].handleId).toBe('image-in')
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0].type).toBe('image')
    expect(manifest.outputs[0].handleId).toBe('image-out')
  })

  it('has correct default data', () => {
    expect(manifest.defaultData.edit_mode).toBe('EDIT_MODE_INPAINT_REMOVAL')
    expect(manifest.defaultData.mask_mode).toBe('MASK_MODE_BACKGROUND')
    expect(manifest.defaultData.mask_dilation).toBe(0.01)
    expect(manifest.defaultData.number_of_images).toBe(1)
  })
})
