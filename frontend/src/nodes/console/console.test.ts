import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('console manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('console')
    expect(manifest.label).toBe('Console')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has correct inputs and outputs', () => {
    expect(manifest.inputs).toHaveLength(0)
    expect(manifest.outputs).toHaveLength(0)
  })

  it('has empty defaultData', () => {
    expect(manifest.defaultData).toEqual({})
  })
})
