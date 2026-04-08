import { describe, expect, it } from 'vitest'
import manifest from './node.manifest'

describe('text-note manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('textNote')
    expect(manifest.label).toBe('Text Note')
    expect(manifest.category).toBe('utility')
  })

  it('has no inputs or outputs', () => {
    expect(manifest.inputs).toHaveLength(0)
    expect(manifest.outputs).toHaveLength(0)
  })

  it('has default text and font settings', () => {
    expect(manifest.defaultData.text).toBe('New Note')
    expect(manifest.defaultData.fontSize).toBe(12)
  })
})
