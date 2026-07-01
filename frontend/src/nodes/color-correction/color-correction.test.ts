import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('color-correction manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('colorCorrection')
    expect(manifest.label).toBe('Color Correction')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'image', handleId: 'image-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'image', handleId: 'image-out' })
  })

  it('defaults BCS to identity (100% / 100% / 100%)', () => {
    expect(manifest.defaultData.brightness).toBe(100)
    expect(manifest.defaultData.contrast).toBe(100)
    expect(manifest.defaultData.saturation).toBe(100)
  })
})
