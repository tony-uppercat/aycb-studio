import type { Node, Edge, Viewport } from '@xyflow/react'

interface SubGraphData {
  sub_graph: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
}

function is_subnet(node: Node): node is Node & { data: SubGraphData } {
  return node.type === 'subnet' && (node.data as any)?.sub_graph !== undefined
}

/**
 * DFS walk to find the path to a target node. Returns an array of subnet ids
 * leading to the target (NOT including the target), or null if not found.
 * Root-level nodes return an empty array.
 */
export function findNodePathInTree(root_nodes: Node[], target_id: string): string[] | null {
  for (const node of root_nodes) {
    if (node.id === target_id) return []
    if (is_subnet(node)) {
      const inner = findNodePathInTree(node.data.sub_graph.nodes, target_id)
      if (inner !== null) return [node.id, ...inner]
    }
  }
  return null
}

/**
 * Walk the tree to the given path depth and return the nodes/edges at that level.
 * Empty path returns the root level (using provided root_edges).
 * Invalid path returns empty arrays.
 */
export function resolveLevel(
  root_nodes: Node[],
  root_edges: Edge[],
  path: string[],
): { nodes: Node[]; edges: Edge[]; viewport: Viewport } {
  if (path.length === 0) {
    return { nodes: root_nodes, edges: root_edges, viewport: { x: 0, y: 0, zoom: 1 } }
  }
  let current_nodes = root_nodes
  let current_edges: Edge[] = []
  let current_viewport: Viewport = { x: 0, y: 0, zoom: 1 }
  for (const subnet_id of path) {
    const subnet = current_nodes.find((n) => n.id === subnet_id)
    if (!subnet || !is_subnet(subnet)) {
      return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    }
    current_nodes = subnet.data.sub_graph.nodes
    current_edges = subnet.data.sub_graph.edges
    current_viewport = subnet.data.sub_graph.viewport
  }
  return { nodes: current_nodes, edges: current_edges, viewport: current_viewport }
}

/**
 * Return a new root_nodes array where the nodes at the given path have been
 * transformed by updater. Uses structural sharing — does not mutate input.
 */
export function updateNodesAtPath(
  root_nodes: Node[],
  path: string[],
  updater: (nodes: Node[]) => Node[],
): Node[] {
  if (path.length === 0) return updater(root_nodes)
  const [head, ...rest] = path
  return root_nodes.map((n) => {
    if (n.id !== head || !is_subnet(n)) return n
    return {
      ...n,
      data: {
        ...n.data,
        sub_graph: {
          ...n.data.sub_graph,
          nodes: updateNodesAtPath(n.data.sub_graph.nodes, rest, updater),
        },
      },
    }
  })
}

/**
 * Same as updateNodesAtPath but for edges. Returns both the new tree (for nested
 * updates) and the new root edges (for root-level updates). Caller picks one.
 */
export function updateEdgesAtPath(
  root_nodes: Node[],
  root_edges: Edge[],
  path: string[],
  updater: (edges: Edge[]) => Edge[],
): { new_tree: Node[]; root_edges: Edge[] } {
  if (path.length === 0) {
    return { new_tree: root_nodes, root_edges: updater(root_edges) }
  }
  const [head, ...rest] = path
  const new_tree = root_nodes.map((n) => {
    if (n.id !== head || !is_subnet(n)) return n
    if (rest.length === 0) {
      return {
        ...n,
        data: {
          ...n.data,
          sub_graph: { ...n.data.sub_graph, edges: updater(n.data.sub_graph.edges) },
        },
      }
    }
    const nested = updateEdgesAtPath(n.data.sub_graph.nodes, n.data.sub_graph.edges, rest, updater)
    return {
      ...n,
      data: {
        ...n.data,
        sub_graph: {
          ...n.data.sub_graph,
          nodes: nested.new_tree,
          edges: nested.root_edges,
        },
      },
    }
  })
  return { new_tree, root_edges }
}

/**
 * Return the edges array stored at the given nested path. Empty path returns
 * the root edges. Invalid path returns an empty array.
 * Used by subnet-input proxies to read the parent level's edges during onRun.
 */
export function getEdgesAtLevel(
  root_nodes: Node[],
  root_edges: Edge[],
  path: string[],
): Edge[] {
  if (path.length === 0) return root_edges
  let current_nodes = root_nodes
  let current_edges: Edge[] = []
  for (const subnet_id of path) {
    const subnet = current_nodes.find((n) => n.id === subnet_id)
    if (!subnet || !is_subnet(subnet)) return []
    current_nodes = subnet.data.sub_graph.nodes
    current_edges = subnet.data.sub_graph.edges
  }
  return current_edges
}

/**
 * Store a viewport at the given nested path. Path must be non-empty
 * (root viewport lives outside the tree).
 */
export function updateViewportAtPath(
  root_nodes: Node[],
  path: string[],
  viewport: Viewport,
): Node[] {
  if (path.length === 0) return root_nodes
  const [head, ...rest] = path
  return root_nodes.map((n) => {
    if (n.id !== head || !is_subnet(n)) return n
    if (rest.length === 0) {
      return {
        ...n,
        data: { ...n.data, sub_graph: { ...n.data.sub_graph, viewport } },
      }
    }
    return {
      ...n,
      data: {
        ...n.data,
        sub_graph: {
          ...n.data.sub_graph,
          nodes: updateViewportAtPath(n.data.sub_graph.nodes, rest, viewport),
        },
      },
    }
  })
}
