import { describe, it, expect, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import manifest from './node.manifest'
import {
  pinsEqual,
  computePinPatch,
  applyRename,
  toggleCollapsed,
  type SubnetNodeData,
} from './SubnetNode'
import type { SubnetPin } from './subnetPins'

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

describe('subnet manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('subnet')
    expect(manifest.label).toBe('Subnet')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
    expect(manifest.icon).toBe('Box')
  })

  it('has empty static inputs/outputs (pins are dynamic from proxies)', () => {
    expect(manifest.inputs).toEqual([])
    expect(manifest.outputs).toEqual([])
  })

  it('defaultData contains an empty sub_graph', () => {
    const d = manifest.defaultData as unknown as SubnetNodeData
    expect(d.sub_graph).toBeDefined()
    expect(d.sub_graph.nodes).toEqual([])
    expect(d.sub_graph.edges).toEqual([])
    expect(d.sub_graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(d.external_inputs).toEqual([])
    expect(d.external_outputs).toEqual([])
  })

  it('defaultData has default name, color, collapsed', () => {
    const d = manifest.defaultData as unknown as SubnetNodeData
    expect(d.name).toBe('Subnet')
    expect(d.color).toBeNull()
    expect(d.collapsed).toBe(false)
  })
})

describe('pinsEqual', () => {
  const pin_a: SubnetPin = { handle_id: 'h1', name: 'prompt', slot_type: 'text' }
  const pin_b: SubnetPin = { handle_id: 'h2', name: 'image', slot_type: 'image' }

  it('returns true for two empty arrays', () => {
    expect(pinsEqual([], [])).toBe(true)
  })

  it('returns true for identical arrays', () => {
    expect(pinsEqual([pin_a, pin_b], [{ ...pin_a }, { ...pin_b }])).toBe(true)
  })

  it('returns false for different lengths', () => {
    expect(pinsEqual([pin_a], [pin_a, pin_b])).toBe(false)
  })

  it('returns false when a handle_id differs', () => {
    expect(pinsEqual([pin_a], [{ ...pin_a, handle_id: 'x' }])).toBe(false)
  })

  it('returns false when a name differs', () => {
    expect(pinsEqual([pin_a], [{ ...pin_a, name: 'other' }])).toBe(false)
  })

  it('returns false when a slot_type differs', () => {
    expect(pinsEqual([pin_a], [{ ...pin_a, slot_type: 'image' }])).toBe(false)
  })
})

describe('computePinPatch — pin derivation from proxies', () => {
  it('derives 2 inputs + 1 output from sub_graph proxies', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h_prompt', 'prompt', 'text', 10),
      make_proxy('subnet-input', 'i2', 'h_image', 'image', 'image', 30),
      make_proxy('subnet-output', 'o1', 'h_result', 'result', 'image', 50),
    ]
    const patch = computePinPatch(sub_nodes, [], [])
    expect(patch).not.toBeNull()
    expect(patch!.external_inputs).toHaveLength(2)
    expect(patch!.external_outputs).toHaveLength(1)
    expect(patch!.external_inputs[0].handle_id).toBe('h_prompt')
    expect(patch!.external_inputs[1].handle_id).toBe('h_image')
    expect(patch!.external_outputs[0].handle_id).toBe('h_result')
  })

  it('returns null when derived pins match current (infinite-loop guard)', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h1', 'prompt', 'text', 10),
      make_proxy('subnet-output', 'o1', 'h2', 'result', 'image', 20),
    ]
    const current_inputs: SubnetPin[] = [
      { handle_id: 'h1', name: 'prompt', slot_type: 'text' },
    ]
    const current_outputs: SubnetPin[] = [
      { handle_id: 'h2', name: 'result', slot_type: 'image' },
    ]
    expect(computePinPatch(sub_nodes, current_inputs, current_outputs)).toBeNull()
  })

  it('returns a patch when a proxy name changes', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h1', 'renamed', 'text', 10),
    ]
    const current_inputs: SubnetPin[] = [
      { handle_id: 'h1', name: 'prompt', slot_type: 'text' },
    ]
    const patch = computePinPatch(sub_nodes, current_inputs, [])
    expect(patch).not.toBeNull()
    expect(patch!.external_inputs[0].name).toBe('renamed')
  })

  it('returns empty arrays for empty sub_graph', () => {
    const patch = computePinPatch([], [{ handle_id: 'h', name: 'x', slot_type: 'text' }], [])
    expect(patch).not.toBeNull()
    expect(patch!.external_inputs).toEqual([])
    expect(patch!.external_outputs).toEqual([])
  })
})

describe('applyRename', () => {
  it('updates data.name with the new trimmed value', () => {
    const update = vi.fn()
    applyRename(update, 'node_1', '  New Name  ')
    expect(update).toHaveBeenCalledWith('node_1', { name: 'New Name' })
  })

  it('falls back to default "Subnet" when blanked out', () => {
    const update = vi.fn()
    applyRename(update, 'node_1', '   ')
    expect(update).toHaveBeenCalledWith('node_1', { name: 'Subnet' })
  })

  it('passes empty-string input through as default', () => {
    const update = vi.fn()
    applyRename(update, 'node_1', '')
    expect(update).toHaveBeenCalledWith('node_1', { name: 'Subnet' })
  })
})

describe('toggleCollapsed', () => {
  it('flips collapsed from false to true', () => {
    const update = vi.fn()
    toggleCollapsed(update, 'node_1', false)
    expect(update).toHaveBeenCalledWith('node_1', { collapsed: true })
  })

  it('flips collapsed from true to false', () => {
    const update = vi.fn()
    toggleCollapsed(update, 'node_1', true)
    expect(update).toHaveBeenCalledWith('node_1', { collapsed: false })
  })
})
