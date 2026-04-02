import { describe, it, expect } from 'vitest'

describe('GroupNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('group')
    expect(manifest.category).toBe('utility')
    expect(manifest.inputs.length).toBe(0)
    expect(manifest.outputs.length).toBe(0)
  })
})
