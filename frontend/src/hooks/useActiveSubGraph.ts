/**
 * useActiveSubGraph — resolves the active sub_graph from the subnet path
 * store and returns {nodes, edges, viewport} plus path-aware setters.
 *
 * The caller (FlowCanvas) owns the root tree state and injects getters +
 * setters via the `root` argument. The hook subscribes to current_path so
 * it re-renders when the user dives in or exits a subnet.
 */
import { useMemo, useCallback } from 'react'
import type { Node, Edge, Viewport } from '@xyflow/react'

import { useSubnetPathStore } from '../stores/subnetPathStore'
import {
  resolveLevel,
  updateNodesAtPath,
  updateEdgesAtPath,
  updateViewportAtPath,
} from './subnetTreeHelpers'

export interface ActiveSubGraphAPI {
  nodes: Node[]
  edges: Edge[]
  viewport: Viewport
  /** Update the nodes at the current level. Caller provides an updater function. */
  setNodesAtActive: (updater: (nodes: Node[]) => Node[]) => void
  /** Update the edges at the current level. */
  setEdgesAtActive: (updater: (edges: Edge[]) => Edge[]) => void
  /** Store the viewport at the current level. */
  setViewportAtActive: (viewport: Viewport) => void
}

export interface RootState {
  root_nodes: Node[]
  root_edges: Edge[]
  root_viewport: Viewport
  setRootNodes: (nodes: Node[]) => void
  setRootEdges: (edges: Edge[]) => void
  setRootViewport: (vp: Viewport) => void
}

/**
 * React hook that returns the active sub_graph (determined by current_path)
 * plus path-aware setters. The caller owns the root tree state and passes
 * getters/setters in via `root`.
 */
export function useActiveSubGraph(root: RootState): ActiveSubGraphAPI {
  const current_path = useSubnetPathStore((s) => s.current_path)

  const { nodes, edges, viewport } = useMemo(() => {
    if (current_path.length === 0) {
      return {
        nodes: root.root_nodes,
        edges: root.root_edges,
        viewport: root.root_viewport,
      }
    }
    return resolveLevel(root.root_nodes, root.root_edges, current_path)
  }, [root.root_nodes, root.root_edges, root.root_viewport, current_path])

  const setNodesAtActive = useCallback(
    (updater: (nodes: Node[]) => Node[]) => {
      if (current_path.length === 0) {
        root.setRootNodes(updater(root.root_nodes))
        return
      }
      root.setRootNodes(updateNodesAtPath(root.root_nodes, current_path, updater))
    },
    [current_path, root],
  )

  const setEdgesAtActive = useCallback(
    (updater: (edges: Edge[]) => Edge[]) => {
      if (current_path.length === 0) {
        root.setRootEdges(updater(root.root_edges))
        return
      }
      const { new_tree } = updateEdgesAtPath(
        root.root_nodes,
        root.root_edges,
        current_path,
        updater,
      )
      root.setRootNodes(new_tree)
    },
    [current_path, root],
  )

  const setViewportAtActive = useCallback(
    (vp: Viewport) => {
      if (current_path.length === 0) {
        root.setRootViewport(vp)
        return
      }
      root.setRootNodes(updateViewportAtPath(root.root_nodes, current_path, vp))
    },
    [current_path, root],
  )

  return {
    nodes,
    edges,
    viewport,
    setNodesAtActive,
    setEdgesAtActive,
    setViewportAtActive,
  }
}
