import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('switch manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('switch')
    expect(manifest.label).toBe('Switch')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.inputs[0]).toEqual({ type: 'text', handleId: 'text-in' })
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0]).toEqual({ type: 'text', handleId: 'text-out' })
  })

  it('has correct defaultData', () => {
    expect(manifest.defaultData).toEqual({ activeChannel: 0 })
  })
})
