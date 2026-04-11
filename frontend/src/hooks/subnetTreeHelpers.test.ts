import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import {
  findNodePathInTree,
  resolveLevel,
  updateNodesAtPath,
  updateEdgesAtPath,
  updateViewportAtPath,
  getEdgesAtLevel,
} from './subnetTreeHelpers'

function make_subnet(id: string, children: Node[] = [], edges: Edge[] = []): Node {
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
    },
  }
}

function make_plain(id: string): Node {
  return { id, type: 'text-input', position: { x: 0, y: 0 }, data: {} }
}

describe('findNodePathInTree', () => {
  it('returns empty array for root-level node', () => {
    const tree: Node[] = [make_plain('a'), make_plain('b')]
    expect(findNodePathInTree(tree, 'a')).toEqual([])
  })

  it('returns path to node inside one subnet', () => {
    const tree: Node[] = [
      make_subnet('s1', [make_plain('inner')]),
    ]
    expect(findNodePathInTree(tree, 'inner')).toEqual(['s1'])
  })

  it('returns path to deeply nested node', () => {
    const tree: Node[] = [
      make_subnet('s1', [
        make_subnet('s2', [
          make_subnet('s3', [make_plain('deep')]),
        ]),
      ]),
    ]
    expect(findNodePathInTree(tree, 'deep')).toEqual(['s1', 's2', 's3'])
  })

  it('returns null for nonexistent node', () => {
    const tree: Node[] = [make_plain('a')]
    expect(findNodePathInTree(tree, 'missing')).toBeNull()
  })

  it('returns empty array when target is a subnet at root', () => {
    const tree: Node[] = [make_subnet('s1')]
    expect(findNodePathInTree(tree, 's1')).toEqual([])
  })
})

describe('resolveLevel', () => {
  it('returns root when path is empty', () => {
    const tree: Node[] = [make_plain('a')]
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }]
    const result = resolveLevel(tree, edges, [])
    expect(result.nodes).toEqual(tree)
    expect(result.edges).toEqual(edges)
  })

  it('returns sub_graph when path is one level deep', () => {
    const inner = make_plain('inner')
    const inner_edge: Edge = { id: 'e1', source: 'inner', target: 'other' }
    const subnet = make_subnet('s1', [inner], [inner_edge])
    const result = resolveLevel([subnet], [], ['s1'])
    expect(result.nodes).toEqual([inner])
    expect(result.edges).toEqual([inner_edge])
  })

  it('returns nested sub_graph for multi-level path', () => {
    const deep = make_plain('deep')
    const tree: Node[] = [
      make_subnet('s1', [make_subnet('s2', [deep])]),
    ]
    const result = resolveLevel(tree, [], ['s1', 's2'])
    expect(result.nodes).toEqual([deep])
  })

  it('returns empty when path points to nonexistent subnet', () => {
    const tree: Node[] = [make_plain('a')]
    const result = resolveLevel(tree, [], ['missing'])
    expect(result.nodes).toEqual([])
    expect(result.edges).toEqual([])
  })
})

describe('updateNodesAtPath', () => {
  it('updates root nodes when path is empty', () => {
    const tree: Node[] = [make_plain('a')]
    const updated = updateNodesAtPath(tree, [], (ns) => [...ns, make_plain('b')])
    expect(updated.map(n => n.id)).toEqual(['a', 'b'])
  })

  it('updates nested sub_graph nodes', () => {
    const tree: Node[] = [make_subnet('s1', [make_plain('a')])]
    const updated = updateNodesAtPath(tree, ['s1'], (ns) => [...ns, make_plain('b')])
    const inner = (updated[0].data as any).sub_graph.nodes
    expect(inner.map((n: Node) => n.id)).toEqual(['a', 'b'])
  })

  it('does not mutate the original tree', () => {
    const tree: Node[] = [make_subnet('s1', [make_plain('a')])]
    const original_inner = (tree[0].data as any).sub_graph.nodes
    updateNodesAtPath(tree, ['s1'], (ns) => [...ns, make_plain('b')])
    expect(original_inner.length).toBe(1)
  })

  it('preserves sibling subnets when updating one', () => {
    const tree: Node[] = [
      make_subnet('s1', [make_plain('a')]),
      make_subnet('s2', [make_plain('b')]),
    ]
    const updated = updateNodesAtPath(tree, ['s1'], (ns) => [...ns, make_plain('c')])
    const s2_inner = (updated[1].data as any).sub_graph.nodes
    expect(s2_inner.map((n: Node) => n.id)).toEqual(['b'])
  })
})

describe('updateEdgesAtPath', () => {
  it('updates root edges when path is empty', () => {
    const tree: Node[] = []
    const edges: Edge[] = []
    const new_edges = updateEdgesAtPath(tree, edges, [], () => [{ id: 'e1', source: 'a', target: 'b' }])
    expect(new_edges.root_edges).toHaveLength(1)
  })

  it('updates nested sub_graph edges', () => {
    const tree: Node[] = [make_subnet('s1', [], [])]
    const new_edges = updateEdgesAtPath(tree, [], ['s1'], () => [{ id: 'e1', source: 'a', target: 'b' }])
    const inner_edges = (new_edges.new_tree[0].data as any).sub_graph.edges
    expect(inner_edges).toHaveLength(1)
  })
})

describe('getEdgesAtLevel', () => {
  it('returns root edges when path is empty', () => {
    const tree: Node[] = []
    const root_edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }]
    expect(getEdgesAtLevel(tree, root_edges, [])).toEqual(root_edges)
  })

  it('returns sub_graph edges at one level deep', () => {
    const inner_edges: Edge[] = [{ id: 'e1', source: 'x', target: 'y' }]
    const tree: Node[] = [make_subnet('s1', [], inner_edges)]
    expect(getEdgesAtLevel(tree, [], ['s1'])).toEqual(inner_edges)
  })

  it('returns empty array for invalid path', () => {
    const tree: Node[] = [make_plain('a')]
    expect(getEdgesAtLevel(tree, [], ['missing'])).toEqual([])
  })

  it('returns nested edges for multi-level path', () => {
    const deep_edges: Edge[] = [{ id: 'e1', source: 'p', target: 'q' }]
    const tree: Node[] = [
      make_subnet('s1', [make_subnet('s2', [], deep_edges)]),
    ]
    expect(getEdgesAtLevel(tree, [], ['s1', 's2'])).toEqual(deep_edges)
  })
})

describe('updateViewportAtPath', () => {
  it('stores viewport at nested path', () => {
    const tree: Node[] = [make_subnet('s1')]
    const new_vp = { x: 100, y: 50, zoom: 1.5 }
    const updated = updateViewportAtPath(tree, ['s1'], new_vp)
    expect((updated[0].data as any).sub_graph.viewport).toEqual(new_vp)
  })

  it('is a no-op at empty path (root viewport lives outside tree)', () => {
    const tree: Node[] = [make_subnet('s1')]
    const updated = updateViewportAtPath(tree, [], { x: 1, y: 2, zoom: 3 })
    expect(updated).toBe(tree)
  })
})

describe('updateEdgesAtPath at depth > 1', () => {
  it('updates edges at depth 2 without clobbering outer edges', () => {
    const deep_edge: Edge = { id: 'new', source: 'x', target: 'y' }
    const s2 = make_subnet('s2', [], [])
    const s1 = make_subnet('s1', [s2], [])
    const tree: Node[] = [s1]
    const root_edges: Edge[] = [{ id: 'root-edge', source: 'a', target: 'b' }]

    const result = updateEdgesAtPath(tree, root_edges, ['s1', 's2'], () => [deep_edge])

    // Root edges unchanged
    expect(result.root_edges).toEqual(root_edges)
    // Deepest edges updated
    const s1_updated = (result.new_tree[0].data as any).sub_graph
    const s2_updated = s1_updated.nodes[0].data.sub_graph
    expect(s2_updated.edges).toEqual([deep_edge])
    // Middle level unchanged
    expect(s1_updated.edges).toEqual([])
  })

  it('preserves sibling subnets at intermediate depths', () => {
    const s2a = make_subnet('s2a', [], [])
    const s2b = make_subnet('s2b', [], [{ id: 'keep', source: 'p', target: 'q' }])
    const s1 = make_subnet('s1', [s2a, s2b], [])
    const result = updateEdgesAtPath([s1], [], ['s1', 's2a'], () => [
      { id: 'added', source: 'x', target: 'y' },
    ])
    const s1_after = (result.new_tree[0].data as any).sub_graph
    const s2b_after = s1_after.nodes[1].data.sub_graph
    // s2b's edges preserved
    expect(s2b_after.edges).toEqual([{ id: 'keep', source: 'p', target: 'q' }])
  })
})
