import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('llm manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('llm')
    expect(manifest.label).toBe('LLM')
    expect(manifest.category).toBe('llm')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(3)
    expect(manifest.inputs[0]).toEqual({ type: 'text', handleId: 'system-in' })
    expect(manifest.inputs[1]).toEqual({ type: 'prompt', handleId: 'prompt-in' })
    expect(manifest.inputs[2]).toEqual({ type: 'media', handleId: 'media-0' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has defaultData with model', () => {
    expect(manifest.defaultData.selectedModel).toBe('gemini-3.1-flash-lite-preview:thinking')
    expect(manifest.defaultData.prompt).toBe('')
    expect(manifest.defaultData.systemPrompt).toBe('')
  })
})
