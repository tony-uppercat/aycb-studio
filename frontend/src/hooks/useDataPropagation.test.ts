/**
 * Tests for useDataPropagation — subnet-aware resolveSource branches.
 *
 * Covers:
 * - Pulling text from a subnet's external output handle (walks into sub_graph
 *   to find the subnet-output proxy matching handle_id)
 * - Pulling text from a subnet-input proxy inside a subnet (reads cached result)
 * - Failure paths: missing result, missing sub_graph, orphan pin
 * - Regression guard: bypass chain still walks upstream
 */
import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { pullText } from './useDataPropagation'

describe('pullText with subnet source', () => {
  it('reads proxy.data.result from subnet-output inside subnet (happy path)', () => {
    const inner_proxy: Node = {
      id: 'proxy-out',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'out1',
        name: 'out1',
        slot_type: 'text',
        result: 'hello',
      },
    }
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Subnet',
        sub_graph: {
          nodes: [inner_proxy],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
        external_outputs: [{ handle_id: 'out1', name: 'out1', slot_type: 'text' }],
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'sub-1',
        sourceHandle: 'out1',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const nodes = [subnet, reader]
    const result = pullText('reader', 'in', () => nodes, () => edges)
    expect(result).toBe('hello')
  })

  it('returns empty string when subnet-output has no cached result (failure path)', () => {
    const inner_proxy: Node = {
      id: 'proxy-out',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'out1',
        name: 'out1',
        slot_type: 'text',
        // result intentionally missing
      },
    }
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [inner_proxy],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'sub-1',
        sourceHandle: 'out1',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const result = pullText('reader', 'in', () => [subnet, reader], () => edges)
    expect(result).toBe('')
  })

  it('reactively walks up through subnet-input proxy to external source', async () => {
    // Inside a subnet: a consumer pulls text from a subnet-input proxy
    // sibling. The proxy has NO data.result cached (no Run was pressed);
    // resolveSource walks up to the containing subnet's external edge and
    // reads the external upstream node directly. This is the post-audit
    // reactive behavior — no need to Run the proxy.
    const { setRootTree, resetRootTree } = await import('./rootTreeGetter')

    const subnet_input_proxy: Node = {
      id: 'proxy-in',
      type: 'subnet-input',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'in1',
        name: 'in1',
        slot_type: 'text',
        // NOTE: no `result` field — the proxy has never Run.
      },
    }
    const consumer: Node = {
      id: 'consumer',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const inner_edges: Edge[] = [{
      id: 'e-inner',
      source: 'proxy-in',
      sourceHandle: 'out',
      target: 'consumer',
      targetHandle: 'in',
    }]

    // Parent-level: an external text-input node feeding the subnet's in1 pin.
    const external_source: Node = {
      id: 'src',
      type: 'textInput',
      position: { x: 0, y: 0 },
      data: { outputText: 'hello from outside' },
    }
    const subnet: Node = {
      id: 'subnet-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [subnet_input_proxy, consumer],
          edges: inner_edges,
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    }
    const external_edge: Edge = {
      id: 'e-ext', source: 'src', sourceHandle: 'text-out',
      target: 'subnet-1', targetHandle: 'in1',
    }

    setRootTree({
      root_nodes: [external_source, subnet],
      root_edges: [external_edge],
    })
    try {
      const result = pullText('consumer', 'in', () => [subnet_input_proxy, consumer], () => inner_edges)
      expect(result).toBe('hello from outside')
    } finally {
      resetRootTree()
    }
  })

  it('returns empty string when subnet-input proxy has no parent edge', async () => {
    const { setRootTree, resetRootTree } = await import('./rootTreeGetter')
    const proxy: Node = {
      id: 'orphan-proxy',
      type: 'subnet-input',
      position: { x: 0, y: 0 },
      data: { handle_id: 'h1', name: 'n', slot_type: 'text' },
    }
    const consumer: Node = { id: 'c', type: 'result-viewer', position: { x: 0, y: 0 }, data: {} }
    const inner_edges: Edge[] = [{ id: 'e', source: 'orphan-proxy', sourceHandle: 'out', target: 'c', targetHandle: 'in' }]
    const subnet: Node = {
      id: 'sub', type: 'subnet', position: { x: 0, y: 0 },
      data: { sub_graph: { nodes: [proxy, consumer], edges: inner_edges, viewport: { x: 0, y: 0, zoom: 1 } } },
    }
    // No external edge feeding the subnet.
    setRootTree({ root_nodes: [subnet], root_edges: [] })
    try {
      const result = pullText('c', 'in', () => [proxy, consumer], () => inner_edges)
      expect(result).toBe('')
    } finally {
      resetRootTree()
    }
  })

  it('returns empty string when subnet has no sub_graph (malformed subnet)', () => {
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        // sub_graph intentionally missing
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'sub-1',
        sourceHandle: 'out1',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const result = pullText('reader', 'in', () => [subnet, reader], () => edges)
    expect(result).toBe('')
  })

  it('returns empty string when subnet-output proxy with matching handle_id not found (orphan pin)', () => {
    // Subnet has a subnet-output proxy, but its handle_id does not match the
    // sourceHandle the reader is pulling from.
    const inner_proxy: Node = {
      id: 'proxy-out',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'other-pin',
        name: 'other-pin',
        slot_type: 'text',
        result: 'should not be read',
      },
    }
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        sub_graph: {
          nodes: [inner_proxy],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'sub-1',
        sourceHandle: 'out1',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const result = pullText('reader', 'in', () => [subnet, reader], () => edges)
    expect(result).toBe('')
  })
})

describe('pullText regression: bypass chain', () => {
  it('walks through a bypassed node to find the real upstream source', () => {
    // source -> bypassed -> reader
    // bypassed node has _bypassed=true; resolver should walk back to source
    const upstream: Node = {
      id: 'upstream',
      type: 'text-input',
      position: { x: 0, y: 0 },
      data: { text: 'from upstream' },
    }
    const bypassed: Node = {
      id: 'bypassed',
      type: 'text-input',
      position: { x: 0, y: 0 },
      data: { _bypassed: true, text: 'should be skipped' },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'upstream',
        sourceHandle: 'out',
        target: 'bypassed',
        targetHandle: 'in',
      },
      {
        id: 'e2',
        source: 'bypassed',
        sourceHandle: 'out',
        target: 'reader',
        targetHandle: 'in',
      },
    ]
    const result = pullText(
      'reader',
      'in',
      () => [upstream, bypassed, reader],
      () => edges,
    )
    expect(result).toBe('from upstream')
  })
})
