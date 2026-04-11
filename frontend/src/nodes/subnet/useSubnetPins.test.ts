import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { buildSubnetPins } from './useSubnetPins'

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
