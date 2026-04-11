import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { serializeNodes } from './useCanvasPersistence'

// Build a small File stand-in. jsdom has File; if missing, fall back to a stub.
function make_file(name: string, contents: string): File {
  return new File([contents], name, { type: 'text/plain' })
}

describe('serializeNodes — flat happy path (baseline)', () => {
  it('strips RF internal keys and File objects from a simple node', () => {
    const file = make_file('a.txt', 'hello')
    const node: Node = {
      id: 'n1',
      type: 'image-upload',
      position: { x: 10, y: 20 },
      // RF internals that must be stripped
      selected: true,
      dragging: false,
      measured: { width: 200, height: 100 },
      data: {
        label: 'Upload',
        file,                  // File must be stripped
        preview: 'blob:http://localhost/abc', // blob URL must be stripped
        result: 'cached',      // LARGE_DATA_KEYS must be stripped
        plain_text: 'keep me', // keep
      },
    } as unknown as Node

    const serialized = serializeNodes([node])
    expect(serialized).toHaveLength(1)
    const s = serialized[0] as unknown as Record<string, unknown>

    // Top-level RF internals stripped
    expect(s.selected).toBeUndefined()
    expect(s.dragging).toBeUndefined()
    expect(s.measured).toBeUndefined()
    // Identity fields preserved
    expect(s.id).toBe('n1')
    expect(s.type).toBe('image-upload')
    expect(s.position).toEqual({ x: 10, y: 20 })

    // Data cleaned
    const d = s.data as Record<string, unknown>
    expect(d.file).toBeUndefined()
    expect(d.preview).toBeUndefined()
    expect(d.result).toBeUndefined()
    expect(d.plain_text).toBe('keep me')
    expect(d.label).toBe('Upload')
  })
})

describe('serializeNodes — nested subnet', () => {
  it('recursively strips File objects from a child inside a subnet', () => {
    const child_file = make_file('child.png', 'bytes')
    const child: Node = {
      id: 'c1',
      type: 'image-upload',
      position: { x: 0, y: 0 },
      data: {
        file: child_file,
        label: 'Child',
      },
    }
    const subnet: Node = {
      id: 's1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Outer',
        sub_graph: { nodes: [child], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        external_inputs: [],
        external_outputs: [],
      },
    }

    const serialized = serializeNodes([subnet])
    const outer_data = serialized[0].data as Record<string, unknown>
    // sub_graph preserved
    expect(outer_data.sub_graph).toBeDefined()
    // external pins preserved
    expect(outer_data.external_inputs).toEqual([])
    expect(outer_data.external_outputs).toEqual([])

    const sg = outer_data.sub_graph as { nodes: Node[]; edges: unknown; viewport: unknown }
    expect(sg.nodes).toHaveLength(1)
    const child_data = sg.nodes[0].data as Record<string, unknown>
    expect(child_data.file).toBeUndefined()
    expect(child_data.label).toBe('Child')
  })

  it('strips last_preview_b64 from a subnet node itself', () => {
    const subnet: Node = {
      id: 's1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Has Preview',
        last_preview_b64: 'data:image/png;base64,AAA...HUGE',
        sub_graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    }
    const serialized = serializeNodes([subnet])
    const data = serialized[0].data as Record<string, unknown>
    expect(data.last_preview_b64).toBeUndefined()
    // But the user's nested work must remain
    expect(data.sub_graph).toBeDefined()
    expect(data.name).toBe('Has Preview')
  })
})

describe('serializeNodes — deep nesting (2 levels)', () => {
  it('strips File from a plain node nested in a subnet inside a subnet', () => {
    const deep_file = make_file('deep.png', 'bytes')
    const deep_child: Node = {
      id: 'deep',
      type: 'image-upload',
      position: { x: 0, y: 0 },
      data: { file: deep_file, label: 'Deep' },
    }
    const inner_subnet: Node = {
      id: 's_inner',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Inner',
        sub_graph: { nodes: [deep_child], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    }
    const outer_subnet: Node = {
      id: 's_outer',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Outer',
        sub_graph: { nodes: [inner_subnet], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    }

    const serialized = serializeNodes([outer_subnet])
    const outer_data = serialized[0].data as Record<string, unknown>
    const outer_sg = outer_data.sub_graph as { nodes: Node[] }
    const inner = outer_sg.nodes[0]
    const inner_sg = (inner.data as Record<string, unknown>).sub_graph as { nodes: Node[] }
    const deep = inner_sg.nodes[0]
    const deep_data = deep.data as Record<string, unknown>

    expect(deep_data.file).toBeUndefined()
    expect(deep_data.label).toBe('Deep')
  })
})

describe('serializeNodes — round-trip via JSON', () => {
  it('preserves subnet id, nested child id, edges, and viewport through stringify/parse', () => {
    const child: Node = {
      id: 'child-1',
      type: 'text-input',
      position: { x: 10, y: 20 },
      data: { text: 'persisted' },
    }
    const proxy_out: Node = {
      id: 'po',
      type: 'subnet-output',
      position: { x: 200, y: 0 },
      data: { handle_id: 'result', name: 'result', slot_type: 'text' },
    }
    const edge = {
      id: 'e1',
      source: 'child-1',
      target: 'po',
      sourceHandle: 'out',
      targetHandle: 'in',
    }
    const viewport = { x: 40, y: 80, zoom: 1.25 }
    const subnet: Node = {
      id: 's1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Round-trip',
        sub_graph: { nodes: [child, proxy_out], edges: [edge], viewport },
      },
    }

    const serialized = serializeNodes([subnet])
    const as_json = JSON.parse(JSON.stringify(serialized))
    const reloaded = as_json[0]

    expect(reloaded.id).toBe('s1')
    expect(reloaded.type).toBe('subnet')
    const sg = reloaded.data.sub_graph
    expect(sg.nodes).toHaveLength(2)
    expect(sg.nodes[0].id).toBe('child-1')
    expect(sg.nodes[0].data.text).toBe('persisted')
    expect(sg.nodes[1].id).toBe('po')
    expect(sg.edges).toHaveLength(1)
    expect(sg.edges[0].source).toBe('child-1')
    expect(sg.edges[0].target).toBe('po')
    expect(sg.viewport).toEqual(viewport)
  })
})

describe('serializeNodes — failure path (malformed subnet)', () => {
  it('does not crash when a subnet has undefined sub_graph and returns a safe structure', () => {
    const broken: Node = {
      id: 'broken',
      type: 'subnet',
      position: { x: 0, y: 0 },
      // intentionally missing sub_graph
      data: {
        name: 'Broken',
      },
    }

    expect(() => serializeNodes([broken])).not.toThrow()
    const serialized = serializeNodes([broken])
    expect(serialized).toHaveLength(1)
    expect(serialized[0].id).toBe('broken')
    const data = serialized[0].data as Record<string, unknown>
    // name must survive; data must still be an object
    expect(data.name).toBe('Broken')
    expect(typeof data).toBe('object')
  })

  it('handles subnet with sub_graph missing nodes array gracefully', () => {
    const partial: Node = {
      id: 'partial',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Partial',
        // sub_graph exists but has no nodes/edges/viewport
        sub_graph: {},
      },
    }

    expect(() => serializeNodes([partial])).not.toThrow()
    const serialized = serializeNodes([partial])
    const data = serialized[0].data as Record<string, unknown>
    expect(data.sub_graph).toBeDefined()
    const sg = data.sub_graph as Record<string, unknown>
    // Safe defaults
    expect(Array.isArray(sg.nodes)).toBe(true)
    expect((sg.nodes as unknown[]).length).toBe(0)
  })
})
