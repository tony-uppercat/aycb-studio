import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('json-parser manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('jsonParser')
    expect(manifest.label).toBe('JSON Parser')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'text', handleId: 'text-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has defaultData', () => {
    expect(manifest.defaultData).toEqual({ jsonPath: '' })
  })
})
