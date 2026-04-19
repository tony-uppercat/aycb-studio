/**
 * Tests for the canvas load-time migrations in useActiveProject.
 *
 * The load-time migrator is load-bearing: any bug here silently
 * corrupts the user's saved canvases on the next open, which is
 * why every rename gets a regression test before shipping.
 */
import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { migrateNodes, migrateSubnets } from './useActiveProject'


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


// ─── migrateSubnets — audit SC1 backward compat ──────────────────────

function makeProxy(
  type: 'subnet-input' | 'subnet-output',
  id: string,
  y: number,
  handle_id: string = '',
): Node {
  return {
    id,
    type,
    position: { x: 0, y },
    data: { handle_id, name: 'pin', slot_type: 'text' },
  }
}

function makeSubnet(id: string, children: Node[], childEdges: Edge[] = []): Node {
  return {
    id,
    type: 'subnet',
    position: { x: 0, y: 0 },
    data: {
      name: id,
      color: null,
      collapsed: false,
      sub_graph: {
        nodes: children,
        edges: childEdges,
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      external_inputs: [],
      external_outputs: [],
    },
  }
}

describe('migrateSubnets (audit SC1 backward compat)', () => {
  it('assigns handle_id to a proxy that shipped with ""', () => {
    const proxy = makeProxy('subnet-input', 'p1', 0)
    const subnet = makeSubnet('s1', [proxy])
    const { nodes } = migrateSubnets([subnet], [])
    const migrated = (nodes[0].data as { sub_graph: { nodes: Node[] } }).sub_graph.nodes[0]
    const mid = (migrated.data as { handle_id: string }).handle_id
    expect(mid).toMatch(/^in-/)
    expect(mid).not.toBe('')
  })

  it('remaps parent-level edge when subnet has exactly one empty-handle input', () => {
    const proxy = makeProxy('subnet-input', 'p1', 0)
    const subnet = makeSubnet('s1', [proxy])
    const upstream: Node = { id: 'src', type: 'text-input', position: { x: 0, y: 0 }, data: {} }
    const edge: Edge = { id: 'e1', source: 'src', sourceHandle: 'text-out', target: 's1', targetHandle: '' }
    const { nodes, edges } = migrateSubnets([upstream, subnet], [edge])
    const newId = ((nodes[1].data as { sub_graph: { nodes: Node[] } })
      .sub_graph.nodes[0].data as { handle_id: string }).handle_id
    expect(edges[0].targetHandle).toBe(newId)
  })

  it('leaves edges alone when multiple empty-handle proxies exist (caller reconnects)', () => {
    const p1 = makeProxy('subnet-input', 'p1', 0)
    const p2 = makeProxy('subnet-input', 'p2', 50)
    const subnet = makeSubnet('s1', [p1, p2])
    const edge: Edge = { id: 'e1', source: 'src', target: 's1', targetHandle: '' }
    const { nodes, edges } = migrateSubnets([subnet], [edge])
    const children = (nodes[0].data as { sub_graph: { nodes: Node[] } }).sub_graph.nodes
    // Both proxies got fresh ids.
    expect((children[0].data as { handle_id: string }).handle_id).not.toBe('')
    expect((children[1].data as { handle_id: string }).handle_id).not.toBe('')
    expect((children[0].data as { handle_id: string }).handle_id)
      .not.toBe((children[1].data as { handle_id: string }).handle_id)
    // Edge stays ambiguous — user reconnects.
    expect(edges[0].targetHandle).toBe('')
  })

  it('leaves already-migrated proxies untouched', () => {
    const proxy = makeProxy('subnet-input', 'p1', 0, 'in-existing-id')
    const subnet = makeSubnet('s1', [proxy])
    const { nodes } = migrateSubnets([subnet], [])
    const hid = ((nodes[0].data as { sub_graph: { nodes: Node[] } })
      .sub_graph.nodes[0].data as { handle_id: string }).handle_id
    expect(hid).toBe('in-existing-id')
  })

  it('recurses into nested subnets', () => {
    const innerProxy = makeProxy('subnet-input', 'inner', 0)
    const innerSubnet = makeSubnet('inner-s', [innerProxy])
    const outerProxy = makeProxy('subnet-output', 'outer', 0)
    const outerSubnet = makeSubnet('outer-s', [outerProxy, innerSubnet])
    const { nodes } = migrateSubnets([outerSubnet], [])
    const outerChildren = (nodes[0].data as { sub_graph: { nodes: Node[] } }).sub_graph.nodes
    const outerProxyMigrated = outerChildren[0].data as { handle_id: string }
    expect(outerProxyMigrated.handle_id).toMatch(/^out-/)
    const innerChildren = (outerChildren[1].data as { sub_graph: { nodes: Node[] } }).sub_graph.nodes
    const innerProxyMigrated = innerChildren[0].data as { handle_id: string }
    expect(innerProxyMigrated.handle_id).toMatch(/^in-/)
  })

  it('returns input references when nothing changed', () => {
    const proxy = makeProxy('subnet-input', 'p1', 0, 'in-already-set')
    const subnet = makeSubnet('s1', [proxy])
    const before = [subnet]
    const edgesBefore: Edge[] = []
    const { nodes, edges } = migrateSubnets(before, edgesBefore)
    // Structural sharing: subnet that needed no change keeps its reference
    expect(nodes[0]).toBe(before[0])
    expect(edges).toBe(edgesBefore)
  })

  it('remaps sub_graph internal edges when nested subnet has empty proxy', () => {
    // Scenario: outer contains inner subnet + upstream; edge from upstream
    // to inner subnet has empty targetHandle. After migration, that edge
    // must be remapped to inner's new in- id.
    const innerProxy = makeProxy('subnet-input', 'inner-p', 0)
    const innerSubnet = makeSubnet('inner-s', [innerProxy])
    const upstream: Node = { id: 'up', type: 'text-input', position: { x: 0, y: 0 }, data: {} }
    const internalEdge: Edge = { id: 'e1', source: 'up', target: 'inner-s', targetHandle: '' }
    const outerSubnet = makeSubnet('outer-s', [upstream, innerSubnet], [internalEdge])
    const { nodes } = migrateSubnets([outerSubnet], [])
    const outerSub = (nodes[0].data as { sub_graph: { edges: Edge[]; nodes: Node[] } }).sub_graph
    const newId = ((outerSub.nodes[1].data as { sub_graph: { nodes: Node[] } })
      .sub_graph.nodes[0].data as { handle_id: string }).handle_id
    expect(outerSub.edges[0].targetHandle).toBe(newId)
  })
})
