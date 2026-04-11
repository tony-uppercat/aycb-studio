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

  it('reads from subnet-input proxy cache (happy path)', () => {
    // Inside a subnet: a regular node pulls from a subnet-input proxy sibling.
    // The subnet-input proxy has already cached the external value in data.result.
    const subnet_input_proxy: Node = {
      id: 'proxy-in',
      type: 'subnet-input',
      position: { x: 0, y: 0 },
      data: {
        handle_id: 'in1',
        name: 'in1',
        slot_type: 'text',
        result: 'world',
      },
    }
    const consumer: Node = {
      id: 'consumer',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      {
        id: 'e1',
        source: 'proxy-in',
        sourceHandle: 'in1',
        target: 'consumer',
        targetHandle: 'in',
      },
    ]
    const nodes = [subnet_input_proxy, consumer]
    const result = pullText('consumer', 'in', () => nodes, () => edges)
    expect(result).toBe('world')
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
