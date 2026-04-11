import { describe, it, expect } from 'vitest'
import type { Node, Edge, Viewport } from '@xyflow/react'
import { applySubGraphUpdate } from './SubnetEditor'

function make_plain(id: string): Node {
  return { id, type: 'text-input', position: { x: 0, y: 0 }, data: { text: 'hello' } }
}

function make_subnet(id: string, sub_graph?: { nodes: Node[]; edges: Edge[]; viewport: Viewport }): Node {
  return {
    id,
    type: 'subnet',
    position: { x: 0, y: 0 },
    data: {
      name: id,
      color: null,
      collapsed: false,
      sub_graph: sub_graph ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      external_inputs: [],
      external_outputs: [],
    },
  }
}

describe('applySubGraphUpdate', () => {
  it('replaces sub_graph on the matching subnet', () => {
    const before = [make_subnet('s1')]
    const new_sg = {
      nodes: [make_plain('inner')],
      edges: [{ id: 'e1', source: 'a', target: 'b' } as Edge],
      viewport: { x: 10, y: 20, zoom: 1.5 },
    }
    const after = applySubGraphUpdate(before, 's1', new_sg)
    const data = after[0].data as { sub_graph: typeof new_sg }
    expect(data.sub_graph).toEqual(new_sg)
  })

  it('preserves other node fields (name, color, external_inputs)', () => {
    const before: Node[] = [
      {
        id: 's1',
        type: 'subnet',
        position: { x: 0, y: 0 },
        data: {
          name: 'MySub',
          color: '#ff0000',
          collapsed: true,
          sub_graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          external_inputs: [{ handle_id: 'in1', name: 'in1', slot_type: 'text' }],
          external_outputs: [],
        },
      },
    ]
    const after = applySubGraphUpdate(before, 's1', { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    const data = after[0].data as Record<string, unknown>
    expect(data.name).toBe('MySub')
    expect(data.color).toBe('#ff0000')
    expect(data.collapsed).toBe(true)
    expect((data.external_inputs as unknown[]).length).toBe(1)
  })

  it('does not mutate other nodes in the array', () => {
    const sibling = make_plain('other')
    const before = [sibling, make_subnet('s1')]
    const after = applySubGraphUpdate(before, 's1', { nodes: [make_plain('x')], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    expect(after[0]).toBe(sibling)
  })

  it('returns unchanged array references when subnet_id not found', () => {
    const before = [make_subnet('s1')]
    const after = applySubGraphUpdate(before, 'missing', { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    expect(after[0]).toBe(before[0])
  })

  it('does not mutate the input array or original subnet data', () => {
    const before = [make_subnet('s1')]
    const before_data = before[0].data as { sub_graph: { nodes: Node[] } }
    const before_inner = before_data.sub_graph.nodes
    const new_sg = { nodes: [make_plain('new')], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    applySubGraphUpdate(before, 's1', new_sg)
    // Original sub_graph.nodes reference untouched
    expect(before_data.sub_graph.nodes).toBe(before_inner)
    expect(before_inner.length).toBe(0)
  })
})
