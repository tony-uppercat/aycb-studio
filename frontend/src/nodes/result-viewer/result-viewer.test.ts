import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('result-viewer manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('resultViewer')
    expect(manifest.label).toBe('Result Viewer')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'text', handleId: 'text-in' })
    expect(manifest.outputs).toHaveLength(0)
  })

  it('has empty defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
