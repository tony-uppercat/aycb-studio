import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { buildSubnetPins, commitPendingPin } from './subnetPins'

function make_proxy(
  type: 'subnet-input' | 'subnet-output',
  id: string,
  handle_id: string,
  name: string,
  slot_type: string,
  y: number,
): Node {
  return {
    id,
    type,
    position: { x: 0, y },
    data: { handle_id, name, slot_type },
  }
}

describe('buildSubnetPins', () => {
  it('extracts inputs and outputs from sub_graph', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h1', 'prompt', 'text', 10),
      make_proxy('subnet-output', 'o1', 'h2', 'result', 'image', 30),
      make_proxy('subnet-input', 'i2', 'h3', 'image', 'image', 50),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_inputs).toHaveLength(2)
    expect(result.external_outputs).toHaveLength(1)
  })

  it('sorts inputs by y-position (top to bottom)', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h1', 'second', 'text', 50),
      make_proxy('subnet-input', 'i2', 'h2', 'first', 'text', 10),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_inputs.map((p) => p.name)).toEqual(['first', 'second'])
  })

  it('sorts outputs by y-position', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-output', 'o1', 'h1', 'bottom', 'text', 100),
      make_proxy('subnet-output', 'o2', 'h2', 'top', 'text', 5),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_outputs.map((p) => p.name)).toEqual(['top', 'bottom'])
  })

  it('ignores non-proxy nodes', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h1', 'in', 'text', 10),
      { id: 'llm', type: 'llm', position: { x: 0, y: 20 }, data: {} },
      make_proxy('subnet-output', 'o1', 'h2', 'out', 'text', 30),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_inputs).toHaveLength(1)
    expect(result.external_outputs).toHaveLength(1)
  })

  it('preserves handle_id, name, slot_type on each pin', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'my-handle', 'prompt', 'text', 10),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_inputs[0]).toEqual({
      handle_id: 'my-handle',
      name: 'prompt',
      slot_type: 'text',
    })
  })

  it('returns empty arrays for empty sub_graph', () => {
    const result = buildSubnetPins([])
    expect(result.external_inputs).toEqual([])
    expect(result.external_outputs).toEqual([])
  })
})


function make_subnet_with_proxies(proxies: Node[]): Node {
  return {
    id: 's1',
    type: 'subnet',
    position: { x: 0, y: 0 },
    data: {
      name: 's1',
      color: null,
      collapsed: false,
      sub_graph: { nodes: proxies, edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      external_inputs: [],
      external_outputs: [],
    },
  }
}

describe('commitPendingPin', () => {
  it('spawns a subnet-input with in- prefix handle_id', () => {
    const subnet = make_subnet_with_proxies([])
    const { updatedSubGraph, newHandleId } = commitPendingPin(subnet, 'in', 'text')
    expect(newHandleId).toMatch(/^in-/)
    expect(updatedSubGraph.nodes).toHaveLength(1)
    const spawned = updatedSubGraph.nodes[0]
    expect(spawned.type).toBe('subnet-input')
    const d = spawned.data as Record<string, unknown>
    expect(d.handle_id).toBe(newHandleId)
    expect(d.slot_type).toBe('text')
  })

  it('spawns a subnet-output with out- prefix handle_id', () => {
    const subnet = make_subnet_with_proxies([])
    const { updatedSubGraph, newHandleId } = commitPendingPin(subnet, 'out', 'image')
    expect(newHandleId).toMatch(/^out-/)
    expect(updatedSubGraph.nodes[0].type).toBe('subnet-output')
    expect((updatedSubGraph.nodes[0].data as Record<string, unknown>).slot_type).toBe('image')
  })

  it('names by counting existing proxies of the same direction', () => {
    const existing = [
      make_proxy('subnet-input', 'i1', 'h1', 'text_in_1', 'text', 0),
      make_proxy('subnet-input', 'i2', 'h2', 'text_in_2', 'text', 120),
    ]
    const subnet = make_subnet_with_proxies(existing)
    const { updatedSubGraph } = commitPendingPin(subnet, 'in', 'prompt')
    const spawned = updatedSubGraph.nodes[2]
    expect((spawned.data as Record<string, unknown>).name).toBe('prompt_in_3')
  })

  it('positions new proxy below existing ones of same direction', () => {
    const existing = [make_proxy('subnet-input', 'i1', 'h1', 'a', 'text', 0)]
    const subnet = make_subnet_with_proxies(existing)
    const { updatedSubGraph } = commitPendingPin(subnet, 'in', 'text')
    expect(updatedSubGraph.nodes[1].position.y).toBe(120)
  })

  it('preserves existing sub_graph.edges unchanged', () => {
    const existing = [make_proxy('subnet-input', 'i1', 'h1', 'a', 'text', 0)]
    const subnet = make_subnet_with_proxies(existing)
    const edgesRef = (subnet.data as { sub_graph: { edges: unknown[] } }).sub_graph.edges
    const { updatedSubGraph } = commitPendingPin(subnet, 'in', 'text')
    expect(updatedSubGraph.edges).toBe(edgesRef)
  })

  it('works when sub_graph is missing (brand-new subnet)', () => {
    const subnet: Node = {
      id: 's1', type: 'subnet',
      position: { x: 0, y: 0 },
      data: { name: 's1', color: null, collapsed: false, external_inputs: [], external_outputs: [] },
    }
    const { updatedSubGraph } = commitPendingPin(subnet, 'in', 'video')
    expect(updatedSubGraph.nodes).toHaveLength(1)
    expect((updatedSubGraph.nodes[0].data as Record<string, unknown>).slot_type).toBe('video')
  })
})
