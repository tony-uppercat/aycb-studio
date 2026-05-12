import { describe, it, expect } from 'vitest'

describe('FindReplaceNode', () => {
  it('has valid manifest', async () => {
    const { default: manifest } = await import('./node.manifest')
    expect(manifest.type).toBe('findReplace')
    expect(manifest.category).toBe('utility')
    expect(manifest.inputs).toHaveLength(1)
    expect(manifest.outputs).toHaveLength(1)
  })
})
