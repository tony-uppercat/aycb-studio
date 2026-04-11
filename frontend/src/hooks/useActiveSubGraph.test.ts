// @vitest-environment jsdom
/**
 * Tests for useActiveSubGraph — resolves current_path from subnetPathStore
 * into {nodes, edges, viewport} + path-aware setters that operate on the
 * caller-owned root tree state.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Node, Edge, Viewport } from '@xyflow/react'

import { useActiveSubGraph } from './useActiveSubGraph'
import { useSubnetPathStore } from '../stores/subnetPathStore'

function make_subnet(id: string, children: Node[] = [], edges: Edge[] = []): Node {
  return {
    id,
    type: 'subnet',
    position: { x: 0, y: 0 },
    data: {
      name: id,
      color: null,
      collapsed: false,
      sub_graph: { nodes: children, edges, viewport: { x: 1, y: 2, zoom: 0.5 } },
      external_inputs: [],
      external_outputs: [],
    },
  }
}

function make_plain(id: string): Node {
  return { id, type: 'text-input', position: { x: 0, y: 0 }, data: {} }
}

interface RootHarness {
  root_nodes: Node[]
  root_edges: Edge[]
  root_viewport: Viewport
  setRootNodes: (nodes: Node[]) => void
  setRootEdges: (edges: Edge[]) => void
  setRootViewport: (vp: Viewport) => void
}

/**
 * Mutable harness simulating the FlowCanvas state container. The hook
 * re-reads from this object via the closure each render, so mutations
 * require a rerender to be observed.
 */
function make_harness(
  root_nodes: Node[],
  root_edges: Edge[] = [],
  root_viewport: Viewport = { x: 0, y: 0, zoom: 1 },
): RootHarness {
  const h: RootHarness = {
    root_nodes,
    root_edges,
    root_viewport,
    setRootNodes: (nodes) => {
      h.root_nodes = nodes
    },
    setRootEdges: (edges) => {
      h.root_edges = edges
    },
    setRootViewport: (vp) => {
      h.root_viewport = vp
    },
  }
  return h
}

describe('useActiveSubGraph', () => {
  beforeEach(() => {
    useSubnetPathStore.getState().reset()
  })

  describe('root level (empty path)', () => {
    it('returns root nodes/edges/viewport when current_path is empty', () => {
      const root_nodes = [make_plain('a'), make_plain('b')]
      const root_edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }]
      const harness = make_harness(root_nodes, root_edges, { x: 10, y: 20, zoom: 2 })

      const { result } = renderHook(() => useActiveSubGraph(harness))

      expect(result.current.nodes).toBe(root_nodes)
      expect(result.current.edges).toBe(root_edges)
      expect(result.current.viewport).toEqual({ x: 10, y: 20, zoom: 2 })
    })

    it('setNodesAtActive updates root nodes via setRootNodes', () => {
      const harness = make_harness([make_plain('a')])
      const { result, rerender } = renderHook(() => useActiveSubGraph(harness))

      act(() => {
        result.current.setNodesAtActive((nodes) => [...nodes, make_plain('b')])
      })
      rerender()

      expect(harness.root_nodes.map((n) => n.id)).toEqual(['a', 'b'])
      expect(result.current.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    })

    it('setEdgesAtActive updates root edges via setRootEdges', () => {
      const harness = make_harness([make_plain('a'), make_plain('b')], [])
      const { result, rerender } = renderHook(() => useActiveSubGraph(harness))

      act(() => {
        result.current.setEdgesAtActive(() => [{ id: 'e1', source: 'a', target: 'b' }])
      })
      rerender()

      expect(harness.root_edges).toEqual([{ id: 'e1', source: 'a', target: 'b' }])
    })

    it('setViewportAtActive updates root viewport via setRootViewport', () => {
      const harness = make_harness([])
      const { result } = renderHook(() => useActiveSubGraph(harness))

      act(() => {
        result.current.setViewportAtActive({ x: 100, y: 200, zoom: 1.5 })
      })

      expect(harness.root_viewport).toEqual({ x: 100, y: 200, zoom: 1.5 })
    })
  })

  describe('nested level (non-empty path)', () => {
    it('returns nested nodes/edges/viewport when path is set', () => {
      const inner_nodes = [make_plain('inner_a'), make_plain('inner_b')]
      const inner_edges: Edge[] = [{ id: 'ie1', source: 'inner_a', target: 'inner_b' }]
      const subnet = make_subnet('s1', inner_nodes, inner_edges)
      const harness = make_harness([subnet])

      useSubnetPathStore.getState().enter('s1')
      const { result } = renderHook(() => useActiveSubGraph(harness))

      expect(result.current.nodes).toBe(inner_nodes)
      expect(result.current.edges).toBe(inner_edges)
      expect(result.current.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })
    })

    it('setNodesAtActive updates nested nodes without mutating input', () => {
      const inner_nodes = [make_plain('inner_a')]
      const subnet = make_subnet('s1', inner_nodes)
      const original_root = [subnet]
      const harness = make_harness(original_root)

      useSubnetPathStore.getState().enter('s1')
      const { result, rerender } = renderHook(() => useActiveSubGraph(harness))

      act(() => {
        result.current.setNodesAtActive((nodes) => [...nodes, make_plain('inner_b')])
      })
      rerender()

      // Input not mutated (structural sharing)
      expect(inner_nodes.map((n) => n.id)).toEqual(['inner_a'])
      expect(original_root[0]).toBe(subnet)
      // New tree carries the added node
      const updated_subnet = harness.root_nodes.find((n) => n.id === 's1') as Node & {
        data: { sub_graph: { nodes: Node[] } }
      }
      expect(updated_subnet.data.sub_graph.nodes.map((n) => n.id)).toEqual([
        'inner_a',
        'inner_b',
      ])
    })

    it('setEdgesAtActive updates nested edges and writes a new root tree', () => {
      const inner = [make_plain('x'), make_plain('y')]
      const subnet = make_subnet('s1', inner, [])
      const harness = make_harness([subnet])

      useSubnetPathStore.getState().enter('s1')
      const { result, rerender } = renderHook(() => useActiveSubGraph(harness))

      act(() => {
        result.current.setEdgesAtActive(() => [{ id: 'ne', source: 'x', target: 'y' }])
      })
      rerender()

      const updated = harness.root_nodes.find((n) => n.id === 's1') as Node & {
        data: { sub_graph: { edges: Edge[] } }
      }
      expect(updated.data.sub_graph.edges).toEqual([{ id: 'ne', source: 'x', target: 'y' }])
      // Root edges untouched at nested level
      expect(harness.root_edges).toEqual([])
    })

    it('setViewportAtActive stores viewport at the nested path', () => {
      const subnet = make_subnet('s1', [make_plain('a')])
      const harness = make_harness([subnet])

      useSubnetPathStore.getState().enter('s1')
      const { result, rerender } = renderHook(() => useActiveSubGraph(harness))

      act(() => {
        result.current.setViewportAtActive({ x: 42, y: 42, zoom: 3 })
      })
      rerender()

      const updated = harness.root_nodes.find((n) => n.id === 's1') as Node & {
        data: { sub_graph: { viewport: Viewport } }
      }
      expect(updated.data.sub_graph.viewport).toEqual({ x: 42, y: 42, zoom: 3 })
      // Root viewport untouched
      expect(harness.root_viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    })
  })

  describe('path reactivity', () => {
    it('re-resolves when current_path changes (enter then exit)', () => {
      const inner = [make_plain('inner_a')]
      const subnet = make_subnet('s1', inner)
      const harness = make_harness([subnet])

      const { result } = renderHook(() => useActiveSubGraph(harness))

      // Root level
      expect(result.current.nodes.map((n) => n.id)).toEqual(['s1'])

      act(() => {
        useSubnetPathStore.getState().enter('s1')
      })
      expect(result.current.nodes.map((n) => n.id)).toEqual(['inner_a'])

      act(() => {
        useSubnetPathStore.getState().exit()
      })
      expect(result.current.nodes.map((n) => n.id)).toEqual(['s1'])
    })
  })
})
