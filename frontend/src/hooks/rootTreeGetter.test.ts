import { describe, it, expect, beforeEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { setRootTree, getRootTree, resetRootTree } from './rootTreeGetter'

describe('rootTreeGetter', () => {
  beforeEach(() => {
    resetRootTree()
  })

  it('returns empty arrays after reset', () => {
    const tree = getRootTree()
    expect(tree.root_nodes).toEqual([])
    expect(tree.root_edges).toEqual([])
  })

  it('stores and returns the latest root tree', () => {
    const nodes: Node[] = [{ id: 'a', position: { x: 0, y: 0 }, data: {} }]
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }]
    setRootTree({ root_nodes: nodes, root_edges: edges })
    const tree = getRootTree()
    expect(tree.root_nodes).toEqual(nodes)
    expect(tree.root_edges).toEqual(edges)
  })

  it('overwrites previous tree on subsequent setRootTree calls', () => {
    setRootTree({
      root_nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: {} }],
      root_edges: [],
    })
    setRootTree({
      root_nodes: [{ id: 'b', position: { x: 0, y: 0 }, data: {} }],
      root_edges: [{ id: 'e2', source: 'b', target: 'c' }],
    })
    const tree = getRootTree()
    expect(tree.root_nodes).toHaveLength(1)
    expect(tree.root_nodes[0].id).toBe('b')
    expect(tree.root_edges).toHaveLength(1)
  })

  it('resetRootTree clears the snapshot', () => {
    setRootTree({
      root_nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: {} }],
      root_edges: [{ id: 'e1', source: 'a', target: 'b' }],
    })
    resetRootTree()
    const tree = getRootTree()
    expect(tree.root_nodes).toEqual([])
    expect(tree.root_edges).toEqual([])
  })
})
