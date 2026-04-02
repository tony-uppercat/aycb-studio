import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('video-upload manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('videoUpload')
    expect(manifest.label).toBe('Video Upload')
    expect(manifest.category).toBe('input')
    expect(manifest.icon).toBe('🎥')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(0)
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'video', handleId: 'video-out' })
  })

  it('has empty defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
