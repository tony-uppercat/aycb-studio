/**
 * Tests for the canvas load-time migrations in useActiveProject.
 *
 * The load-time migrator is load-bearing: any bug here silently
 * corrupts the user's saved canvases on the next open, which is
 * why every rename gets a regression test before shipping.
 */
import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { migrateNodes } from './useActiveProject'


function makeNode(type: string, data: Record<string, unknown>): Node {
  return {
    id: `n1`,
    type,
    position: { x: 0, y: 0 },
    data,
  }
}


describe('migrateNodes — BracketParser snake_case → camelCase (audit m9)', () => {
  it('renames output_mode to outputMode', () => {
    const [out] = migrateNodes([makeNode('bracketParser', {
      output_mode: 'items', text: 'hello',
    })])
    expect(out.data).toEqual({ outputMode: 'items', text: 'hello' })
  })

  it('renames every known field in one pass', () => {
    const [out] = migrateNodes([makeNode('bracketParser', {
      output_mode: 'template',
      excluded_keys: ['a', 'b'],
      output_limit: 5,
      output_override: 'custom',
      pins_collapsed: true,
      preview_collapsed: false,
      text_collapsed: true,
      overrides: { a: '1' },  // already camelCase-ish name; passes through
    })])
    expect(out.data).toEqual({
      outputMode: 'template',
      excludedKeys: ['a', 'b'],
      outputLimit: 5,
      outputOverride: 'custom',
      pinsCollapsed: true,
      previewCollapsed: false,
      textCollapsed: true,
      overrides: { a: '1' },
    })
  })

  it('prefers the new key when both are present (user has re-saved since)', () => {
    const [out] = migrateNodes([makeNode('bracketParser', {
      output_mode: 'items',
      outputMode: 'template',
    })])
    // New key wins — old key dropped.
    expect(out.data).toEqual({ outputMode: 'template' })
  })

  it('leaves already-migrated data untouched (idempotent)', () => {
    const node = makeNode('bracketParser', {
      outputMode: 'items',
      excludedKeys: ['x'],
    })
    const [first] = migrateNodes([node])
    const [second] = migrateNodes([first])
    expect(second.data).toEqual({ outputMode: 'items', excludedKeys: ['x'] })
  })

  it('ignores nodes of other types', () => {
    const input = [
      makeNode('generateImage', { output_mode: 'should-not-touch' }),
      makeNode('jsonParser', { output_mode: 'should-not-touch-either' }),
    ]
    const out = migrateNodes(input)
    expect(out[0].data).toEqual({ output_mode: 'should-not-touch' })
    expect(out[1].data).toEqual({ output_mode: 'should-not-touch-either' })
  })

  it('ignores bracketParser nodes without any legacy keys', () => {
    const node = makeNode('bracketParser', { text: 'hi' })
    const [out] = migrateNodes([node])
    // Same reference when nothing changed — cheap idempotency signal.
    expect(out).toBe(node)
  })

  it('handles nodes with no data field', () => {
    const node = { id: 'n1', type: 'bracketParser', position: { x: 0, y: 0 } } as unknown as Node
    const [out] = migrateNodes([node])
    expect(out).toBe(node)
  })
})
