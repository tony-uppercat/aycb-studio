import { describe, it, expect, vi } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import manifest from './node.manifest'
import SubnetInputNode, { buildInputOnRun, type SubnetInputNodeData } from './SubnetInputNode'

describe('subnet-input manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('subnet-input')
    expect(manifest.label).toBe('Subnet Input')
    expect(manifest.category).toBe('utility')
    expect(manifest.description).toBeTruthy()
  })

  it('has no inputs (proxy is a source)', () => {
    expect(manifest.inputs).toHaveLength(0)
  })

  it('has one output handle', () => {
    expect(manifest.outputs).toHaveLength(1)
    expect(manifest.outputs[0].handleId).toBe('out')
  })

  it('defaults include handle_id, name, slot_type', () => {
    const d = manifest.defaultData as {
      handle_id: string
      name: string
      slot_type: string
    }
    expect(d).toHaveProperty('handle_id')
    expect(d).toHaveProperty('name')
    expect(d).toHaveProperty('slot_type')
    expect(d.slot_type).toBe('text')
    expect(d.name).toBe('input')
  })
})

describe('SubnetInputNode component', () => {
  it('module exports a default component', () => {
    expect(SubnetInputNode).toBeDefined()
    expect(typeof SubnetInputNode).toBe('object') // memo returns an object with $$typeof
  })
})

// ── buildInputOnRun pure helper ───────────────────────────────────────────
//
// The proxy's onRun walks UP the tree to find the external edge on the parent
// subnet's pin. Each test builds a fake root tree and injects it via
// get_root_tree so we don't touch the global rootTreeGetter state.

type NodeData = Record<string, unknown>

function makeTextSource(id: string, text: string): Node {
  return {
    id,
    type: 'text-input',
    position: { x: 0, y: 0 },
    data: { outputText: text } as NodeData,
  } as Node
}

function makeMediaSource(id: string, file: File): Node {
  return {
    id,
    type: 'image-upload',
    position: { x: 0, y: 0 },
    data: { file } as NodeData,
  } as Node
}

function makeProxy(id: string, handle_id: string): Node {
  return {
    id,
    type: 'subnet-input',
    position: { x: 0, y: 0 },
    data: { handle_id, name: handle_id, slot_type: 'text' } as NodeData,
  } as Node
}

function makeSubnet(
  id: string,
  children: Node[],
  edges: Edge[] = [],
): Node {
  return {
    id,
    type: 'subnet',
    position: { x: 0, y: 0 },
    data: {
      name: id,
      color: null,
      collapsed: false,
      sub_graph: { nodes: children, edges, viewport: { x: 0, y: 0, zoom: 1 } },
      external_inputs: [],
      external_outputs: [],
    } as NodeData,
  } as Node
}

function edge(source: string, target: string, targetHandle: string, sourceHandle = 'out'): Edge {
  return { id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle, targetHandle }
}

describe('buildInputOnRun', () => {
  it('is exported as a function', () => {
    expect(typeof buildInputOnRun).toBe('function')
  })

  it('reads external text value when proxy is inside a subnet with an incoming edge', async () => {
    // Root has: text-source → subnet s1(@in1). Inside s1: proxy reads from in1.
    const proxy_id = 'proxy-1'
    const proxy = makeProxy(proxy_id, 'in1')
    const subnet = makeSubnet('s1', [proxy])
    const source = makeTextSource('src-1', 'hello')
    const root_nodes: Node[] = [source, subnet]
    const root_edges: Edge[] = [edge('src-1', 's1', 'in1')]
    const data: SubnetInputNodeData = {
      handle_id: 'in1',
      name: 'input',
      slot_type: 'text',
    }
    const updateNodeData = vi.fn()

    const onRun = buildInputOnRun(
      proxy_id,
      () => data,
      () => ({ root_nodes, root_edges }),
      updateNodeData,
    )
    await onRun()

    expect(updateNodeData).toHaveBeenCalledWith(proxy_id, { result: 'hello' })
  })

  it('writes null when proxy is orphaned (not inside any subnet)', async () => {
    // Proxy sits at root level — not inside a subnet → orphan.
    const proxy_id = 'proxy-orphan'
    const proxy = makeProxy(proxy_id, 'in1')
    const root_nodes: Node[] = [proxy]
    const root_edges: Edge[] = []
    const data: SubnetInputNodeData = {
      handle_id: 'in1',
      name: 'input',
      slot_type: 'text',
    }
    const updateNodeData = vi.fn()

    const onRun = buildInputOnRun(
      proxy_id,
      () => data,
      () => ({ root_nodes, root_edges }),
      updateNodeData,
    )
    await onRun()

    expect(updateNodeData).toHaveBeenCalledWith(proxy_id, { result: null })
  })

  it('writes null when parent subnet has no incoming edge on this handle_id', async () => {
    // Subnet exists, proxy is inside, but no external edge targets s1@in1.
    const proxy_id = 'proxy-2'
    const proxy = makeProxy(proxy_id, 'in1')
    const subnet = makeSubnet('s1', [proxy])
    const root_nodes: Node[] = [subnet]
    const root_edges: Edge[] = [] // no incoming edge
    const data: SubnetInputNodeData = {
      handle_id: 'in1',
      name: 'input',
      slot_type: 'text',
    }
    const updateNodeData = vi.fn()

    const onRun = buildInputOnRun(
      proxy_id,
      () => data,
      () => ({ root_nodes, root_edges }),
      updateNodeData,
    )
    await onRun()

    expect(updateNodeData).toHaveBeenCalledWith(proxy_id, { result: null })
  })

  it('writes media.file for image slot_type', async () => {
    const proxy_id = 'proxy-img'
    const proxy = makeProxy(proxy_id, 'in_img')
    const subnet = makeSubnet('s1', [proxy])
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const source = makeMediaSource('src-img', file)
    const root_nodes: Node[] = [source, subnet]
    const root_edges: Edge[] = [edge('src-img', 's1', 'in_img')]
    const data: SubnetInputNodeData = {
      handle_id: 'in_img',
      name: 'input',
      slot_type: 'image',
    }
    const updateNodeData = vi.fn()

    const onRun = buildInputOnRun(
      proxy_id,
      () => data,
      () => ({ root_nodes, root_edges }),
      updateNodeData,
    )
    await onRun()

    expect(updateNodeData).toHaveBeenCalledTimes(1)
    const call = updateNodeData.mock.calls[0]
    expect(call[0]).toBe(proxy_id)
    expect(call[1]).toEqual({ result: file })
  })

  it('works at depth 2 (nested subnet) — reads from the parent subnet s2, not s1', async () => {
    // Tree:
    //   root: [text-source 'inner-val', s1]
    //     s1.sub_graph.nodes: [s2]
    //     s1.sub_graph.edges: [inner-src → s2@in1]
    //       wait, inner-src lives at root. That wouldn't work —
    //       let's place the inner source INSIDE s1 instead.
    //
    // Corrected tree:
    //   root: [s1]
    //     s1.sub_graph.nodes: [inner-src, s2]
    //     s1.sub_graph.edges: [inner-src → s2@in1]
    //       s2.sub_graph.nodes: [proxy]
    //       s2.sub_graph.edges: []
    //
    // Proxy.handle_id = 'in1'. Parent = s2. Parent level = inside s1.
    // Expected: proxy reads 'inner-val' from inner-src via the edge inside s1.
    const proxy_id = 'proxy-deep'
    const proxy = makeProxy(proxy_id, 'in1')
    const s2 = makeSubnet('s2', [proxy], [])
    const inner_src = makeTextSource('inner-src', 'inner-val')
    const s1_edges: Edge[] = [edge('inner-src', 's2', 'in1')]
    const s1 = makeSubnet('s1', [inner_src, s2], s1_edges)
    const root_nodes: Node[] = [s1]
    const root_edges: Edge[] = []
    const data: SubnetInputNodeData = {
      handle_id: 'in1',
      name: 'input',
      slot_type: 'text',
    }
    const updateNodeData = vi.fn()

    const onRun = buildInputOnRun(
      proxy_id,
      () => data,
      () => ({ root_nodes, root_edges }),
      updateNodeData,
    )
    await onRun()

    expect(updateNodeData).toHaveBeenCalledWith(proxy_id, { result: 'inner-val' })
  })
})
