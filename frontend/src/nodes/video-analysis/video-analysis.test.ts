import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('video-analysis manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('videoAnalysis')
    expect(manifest.label).toBe('Video Analysis')
    expect(manifest.category).toBe('llm')
    expect(manifest.icon).toBe('🎬')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(2)
    expect(manifest.inputs[0]).toEqual({ type: 'video', handleId: 'video-in' })
    expect(manifest.inputs[1]).toEqual({ type: 'prompt', handleId: 'prompt-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has defaultData with mode and maxFrames', () => {
    expect(manifest.defaultData.mode).toBe('sharp')
    expect(manifest.defaultData.maxFrames).toBe(3)
  })
})
