import type { Node, Edge } from '@xyflow/react'

/**
 * Module-level snapshot of the root-level canvas tree.
 *
 * FlowCanvas calls `setRootTree` after every update to its `rootNodes` /
 * `rootEdges` state. Subnet proxy nodes (subnet-input / subnet-output) read
 * via `getRootTree()` inside their `onRun` callback so they can walk the
 * nested tree to reach parent-level edges without prop-drilling.
 *
 * This is deliberately a plain module rather than a Zustand store — the
 * proxies need synchronous read access from inside a plain `useCallback`,
 * and we never want to trigger a React re-render from these reads.
 */
interface RootTree {
  root_nodes: Node[]
  root_edges: Edge[]
}

let current: RootTree = { root_nodes: [], root_edges: [] }

export function setRootTree(tree: RootTree): void {
  current = tree
}

export function getRootTree(): RootTree {
  return current
}

/**
 * Reset the snapshot — used by tests and by project switching so a stale
 * tree from the previous project cannot leak into a new session.
 */
export function resetRootTree(): void {
  current = { root_nodes: [], root_edges: [] }
}
