import { useCallback, useEffect, useRef } from 'react'
import { addEdge, type Node, type Edge } from '@xyflow/react'
import { getNextNodeId } from './useCanvasDragDrop'
import { enforceOneEdgePerInput } from './useConnectionHandlers'
import { edgeStyle } from '../utils/edgeStyles'
import { deleteMedia, deleteMultipleMedia } from '../mediaStore'
import { MANIFEST_MAP } from '../nodes/index'

export interface UseKeyboardShortcutsParams {
  getNodes: () => Node[]
  getEdges: () => Edge[]
  setNodes: (updater: Node[] | ((nodes: Node[]) => Node[])) => void
  setEdges: (updater: Edge[] | ((edges: Edge[]) => Edge[])) => void
  snapshot: (nodes: Node[], edges: Edge[]) => void
  toggleAddMenu: () => void
  toggleMinimap: () => void
  toggleFullscreenBrowser: () => void
  fitView: (options?: { nodes?: Node[]; duration?: number; padding?: number }) => void
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number }
  /** React state nodes — needed by ungroupSelected which iterates nodes directly */
  nodes: Node[]
}

/** Compute the absolute position of a node by walking up the parentId chain. */
function getAbsolutePosition(node: Node, allNodes: Node[]): { x: number; y: number } {
  let x = node.position.x
  let y = node.position.y
  let current = node
  while (current.parentId) {
    const parent = allNodes.find(n => n.id === current.parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    current = parent
  }
  return { x, y }
}

/**
 * Expand selection to include children of any selected group nodes (recursive).
 * Returns the expanded set of nodes to copy/duplicate.
 */
function expandGroupChildren(selected: Node[], allNodes: Node[]): Node[] {
  const ids = new Set(selected.map(n => n.id))
  const queue = [...selected]
  const result: Node[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    if (result.some(n => n.id === node.id)) continue
    result.push(node)
    if (node.type === 'group') {
      for (const child of allNodes) {
        if (child.parentId === node.id && !ids.has(child.id)) {
          ids.add(child.id)
          queue.push(child)
        }
      }
    }
  }
  return result
}

/**
 * Clone a set of nodes + their internal edges, remapping IDs and parentId references.
 */
function cloneNodesAndEdges(
  nodes: Node[], edges: Edge[], prefix: string, offset = { x: 0, y: 0 }
): { clones: Node[]; clonedEdges: Edge[]; oldToNew: Map<string, string> } {
  const oldToNew = new Map<string, string>()
  for (const node of nodes) {
    oldToNew.set(node.id, getNextNodeId(node.type ?? prefix))
  }
  const nodeIds = new Set(nodes.map(n => n.id))
  const clones: Node[] = nodes.map(node => ({
    ...node,
    id: oldToNew.get(node.id)!,
    position: { x: node.position.x + (node.parentId && nodeIds.has(node.parentId) ? 0 : offset.x), y: node.position.y + (node.parentId && nodeIds.has(node.parentId) ? 0 : offset.y) },
    // Remap parentId if the parent is also being cloned
    ...(node.parentId && oldToNew.has(node.parentId) ? { parentId: oldToNew.get(node.parentId)! } : {}),
    selected: false,
    dragging: false,
  }))
  const clonedEdges: Edge[] = edges
    .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map(e => ({
      ...e,
      id: `e-${oldToNew.get(e.source)}-${oldToNew.get(e.target)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: oldToNew.get(e.source)!,
      target: oldToNew.get(e.target)!,
    }))
  return { clones, clonedEdges, oldToNew }
}

/** Delete associated media from IndexedDB for removed nodes. */
function cleanupNodeMedia(deletedNodes: Node[]): void {
  for (const node of deletedNodes) {
    const d = node.data as Record<string, unknown>
    const mediaId = d.mediaId as string | undefined
    if (mediaId) {
      deleteMedia(mediaId).catch(() => { /* silent */ })
    }
    const historyIds = d.historyIds as string[] | undefined
    if (historyIds && historyIds.length > 0) {
      deleteMultipleMedia(historyIds).catch(() => { /* silent */ })
    }
  }
}

export function useKeyboardShortcuts({
  getNodes,
  getEdges,
  setNodes,
  setEdges,
  snapshot,
  toggleAddMenu,
  toggleMinimap,
  toggleFullscreenBrowser,
  fitView,
  screenToFlowPosition,
  nodes,
}: UseKeyboardShortcutsParams): {
  onNodeDragStart: (event: React.MouseEvent) => void
  handleStopAll: () => void
} {
  // ── Stop all running nodes ──────────────────────────────────────────────
  function handleStopAll(): void {
    setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, _stop: Date.now() } })))
  }

  // ── Group / Ungroup ─────────────────────────────────────────────────────
  const groupSelected = useCallback(() => {
    const allNodes = getNodes()
    const selected = allNodes.filter(n => n.selected)
    if (selected.length < 1) return

    const PAD = 30
    const HEADER = 32
    const selectedIds = new Set(selected.map(n => n.id))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    // Use absolute positions for bounding box (handles nested groups)
    const absPositions = new Map<string, { x: number; y: number }>()
    for (const n of selected) {
      const abs = getAbsolutePosition(n, allNodes)
      absPositions.set(n.id, abs)
      const w = (n.style?.width as number) ?? n.measured?.width ?? n.width ?? 200
      const h = (n.style?.height as number) ?? n.measured?.height ?? n.height ?? 150
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + w)
      maxY = Math.max(maxY, abs.y + h)
    }

    const groupId = getNextNodeId('group')
    const gx = minX - PAD
    const gy = minY - PAD - HEADER
    const gw = maxX - minX + PAD * 2
    const gh = maxY - minY + PAD * 2 + HEADER

    // Determine if the new group itself should be nested inside a parent.
    // If ALL selected nodes share the same parentId, the new group inherits it.
    const parentIds = new Set(selected.map(n => n.parentId).filter(Boolean))
    const commonParentId = parentIds.size === 1 ? [...parentIds][0] : undefined

    // If the group has a common parent, its position is relative to that parent
    let groupX = gx
    let groupY = gy
    if (commonParentId) {
      const commonParent = allNodes.find(n => n.id === commonParentId)
      if (commonParent) {
        const parentAbs = getAbsolutePosition(commonParent, allNodes)
        groupX = gx - parentAbs.x
        groupY = gy - parentAbs.y
      }
    }

    const groupNode: Node = {
      id: groupId,
      type: 'group',
      position: { x: groupX, y: groupY },
      ...(commonParentId ? { parentId: commonParentId, extent: 'parent' as const } : {}),
      data: { label: 'Group', collapsed: false },
      style: { width: gw, height: gh },
    }

    const updated = allNodes.map(n => {
      if (!selectedIds.has(n.id)) return { ...n, selected: false }
      // Use absolute position to compute relative-to-new-group position
      const abs = absPositions.get(n.id)!
      return {
        ...n,
        parentId: groupId,
        position: { x: abs.x - gx, y: abs.y - gy },
        selected: false,
      }
    })

    const postNodes = [groupNode, ...updated]
    snapshot(postNodes, getEdges())
    setNodes(postNodes)
  }, [getNodes, getEdges, setNodes, snapshot])

  const ungroupSelected = useCallback(() => {
    const selectedGroups = nodes.filter(n => n.selected && n.type === 'group')
    if (selectedGroups.length === 0) return

    const groupIds = new Set(selectedGroups.map(g => g.id))

    const updated = nodes
      .filter(n => !groupIds.has(n.id))
      .map(n => {
        if (!n.parentId || !groupIds.has(n.parentId)) return n
        const parent = selectedGroups.find(g => g.id === n.parentId)
        if (!parent) return n
        // Compute the absolute position of the parent to restore child's abs position
        const parentAbs = getAbsolutePosition(parent, nodes)
        return {
          ...n,
          parentId: parent.parentId, // inherit grandparent (or undefined if top-level)
          extent: parent.parentId ? ('parent' as const) : undefined,
          position: {
            x: n.position.x + parentAbs.x - (parent.parentId ? getAbsolutePosition(nodes.find(pp => pp.id === parent.parentId)!, nodes).x : 0),
            y: n.position.y + parentAbs.y - (parent.parentId ? getAbsolutePosition(nodes.find(pp => pp.id === parent.parentId)!, nodes).y : 0),
          },
        }
      })

    snapshot(updated, getEdges())
    setNodes(updated)
  }, [nodes, getEdges, setNodes, snapshot])

  // ── Clipboard for Ctrl+C / Ctrl+V ───────────────────────────────────────
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null)

  // ── Ctrl+Drag to duplicate selected nodes ───────────────────────────────
  const duplicatingRef = useRef(false)

  const onNodeDragStart = useCallback((_event: React.MouseEvent) => {
    if (!(_event.ctrlKey || _event.metaKey)) {
      duplicatingRef.current = false
      return
    }

    // Ctrl held — duplicate all selected nodes (including group children)
    const allNodes = getNodes()
    const allEdges = getEdges()
    const selected = expandGroupChildren(allNodes.filter(n => n.selected), allNodes)
    if (selected.length === 0) return

    duplicatingRef.current = true

    const { clones, clonedEdges } = cloneNodesAndEdges(selected, allEdges, 'clone')
    const selectedIds = new Set(selected.map(n => n.id))

    // Deselect originals (they stay in place), add clones (unselected)
    const postNodes = [
      ...getNodes().map(n => selectedIds.has(n.id) ? { ...n } : n),
      ...clones,
    ]
    const postEdges = [...getEdges(), ...clonedEdges]
    snapshot(postNodes, postEdges)
    setNodes(postNodes)
    setEdges(postEdges)
  }, [getNodes, getEdges, setNodes, setEdges, snapshot])

  // ── Unified keyboard handler ─────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const isEditable = (e.target as HTMLElement).isContentEditable
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || isEditable

      // Tab — toggle add-node menu (skip when user is editing text/contentEditable)
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !inInput) {
        e.preventDefault()
        toggleAddMenu()
      }
      // Ctrl+G — group / Ctrl+Shift+G — ungroup
      if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey) {
        e.preventDefault(); groupSelected()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g' && e.shiftKey) {
        e.preventDefault(); ungroupSelected()
      }
      // Shift+Delete — delete group AND all its children
      if (e.shiftKey && e.key === 'Delete' && !inInput) {
        e.preventDefault()
        const allNodes = getNodes()
        const allEdges = getEdges()
        const selGroups = allNodes.filter(n => n.selected && n.type === 'group')
        if (selGroups.length > 0) {
          // Collect group IDs and all descendant node IDs recursively
          const toDelete = new Set<string>(selGroups.map(g => g.id))
          let changed = true
          while (changed) {
            changed = false
            for (const n of allNodes) {
              if (!toDelete.has(n.id) && n.parentId && toDelete.has(n.parentId)) {
                toDelete.add(n.id)
                changed = true
              }
            }
          }
          const postNodes = allNodes.filter(n => !toDelete.has(n.id))
          const postEdges = allEdges.filter(ed =>
            !toDelete.has(ed.source) && !toDelete.has(ed.target) &&
            !((ed.data as Record<string, unknown>)?._bypassOf && toDelete.has((ed.data as Record<string, unknown>)._bypassOf as string))
          )
          const deletedNodes = allNodes.filter(n => toDelete.has(n.id))
          snapshot(postNodes, postEdges)
          setEdges(postEdges)
          setNodes(postNodes)
          cleanupNodeMedia(deletedNodes)
        } else {
          // No group selected — fall back to ungroupSelected
          ungroupSelected()
        }
      }
      // O — toggle minimap
      if (e.key === 'o' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        toggleMinimap()
      }
      // Ctrl+M — toggle fullscreen media browser
      if (e.key === 'm' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault()
        toggleFullscreenBrowser()
      }
      // F — frame/center selected nodes in viewport
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        if (inInput) return
        const selected = getNodes().filter(n => n.selected)
        if (selected.length > 0) {
          e.preventDefault()
          fitView({ nodes: selected, duration: 300, padding: 0.3 })
        }
      }
      // B — toggle bypass on selected nodes (node stays but edges skip it)
      if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !inInput) {
        const sel = getNodes().filter(n => n.selected)
        if (sel.length > 0) {
          e.preventDefault()
          const currentEdges = getEdges()

          let postNodes = getNodes()
          let postEdges = currentEdges

          for (const node of sel) {
            const isBypassed = !!(node.data as Record<string, unknown>)._bypassed
            const newBypassed = !isBypassed

            // Toggle bypass flag on node
            postNodes = postNodes.map(n =>
              n.id === node.id
                ? { ...n, data: { ...n.data, _bypassed: newBypassed } }
                : n
            )

            if (newBypassed) {
              // Create skip edges: connect each incoming source → each outgoing target
              const incoming = postEdges.filter(ed => ed.target === node.id)
              const outgoing = postEdges.filter(ed => ed.source === node.id)
              const skipEdges: typeof postEdges = []
              for (const inc of incoming) {
                for (const out of outgoing) {
                  skipEdges.push({
                    id: `bypass-${inc.source}-${out.target}-${Date.now()}`,
                    source: inc.source,
                    sourceHandle: inc.sourceHandle ?? null,
                    target: out.target,
                    targetHandle: out.targetHandle ?? null,
                    data: { _bypassOf: node.id },
                    style: { stroke: '#555', strokeWidth: 1, strokeDasharray: '4 3' },
                  })
                }
              }
              postEdges = [...postEdges, ...skipEdges]
            } else {
              // Remove skip edges created by this bypass
              postEdges = postEdges.filter(ed =>
                !(ed.data as Record<string, unknown>)?._bypassOf || (ed.data as Record<string, unknown>)?._bypassOf !== node.id
              )
            }
          }

          snapshot(postNodes, postEdges)
          setNodes(postNodes)
          setEdges(postEdges)
        }
      }
      // Ctrl+C — copy selected nodes + internal edges (including group children)
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !inInput) {
        const allNodes = getNodes()
        const sel = expandGroupChildren(allNodes.filter(n => n.selected), allNodes)
        if (sel.length > 0) {
          const selIds = new Set(sel.map(n => n.id))
          const internalEdges = getEdges().filter(ed => selIds.has(ed.source) && selIds.has(ed.target))
          clipboardRef.current = { nodes: sel, edges: internalEdges }
          console.log(`[Copy] ${sel.length} nodes, ${internalEdges.length} edges`)
        }
      }
      // Ctrl+V — paste copied nodes centered in current viewport
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !inInput) {
        const clip = clipboardRef.current
        if (clip && clip.nodes.length > 0) {
          e.preventDefault()

          // Calculate the center of the copied nodes' bounding box
          const nodeIds = new Set(clip.nodes.map(n => n.id))
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const n of clip.nodes) {
            // Only consider top-level nodes (not children of copied groups)
            if (n.parentId && nodeIds.has(n.parentId)) continue
            const w = (n.style?.width as number) ?? n.measured?.width ?? n.width ?? 200
            const h = (n.style?.height as number) ?? n.measured?.height ?? n.height ?? 150
            minX = Math.min(minX, n.position.x)
            minY = Math.min(minY, n.position.y)
            maxX = Math.max(maxX, n.position.x + w)
            maxY = Math.max(maxY, n.position.y + h)
          }
          const clipCenterX = (minX + maxX) / 2
          const clipCenterY = (minY + maxY) / 2

          // Get the center of the current viewport in flow coordinates
          // Use the React Flow container bounds (not window center) so nodes land at the visible canvas center
          const rfContainer = document.querySelector('.react-flow')
          const rect = rfContainer?.getBoundingClientRect()
          const screenCenterX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
          const screenCenterY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
          const viewportCenter = screenToFlowPosition({ x: screenCenterX, y: screenCenterY })

          // Offset = move clipboard center to viewport center
          const offset = { x: viewportCenter.x - clipCenterX, y: viewportCenter.y - clipCenterY }

          const { clones, clonedEdges } = cloneNodesAndEdges(clip.nodes, clip.edges, 'paste', offset)
          // Mark pasted nodes as selected
          clones.forEach(n => { n.selected = true })

          // Deselect existing, add pasted as selected
          const postNodes = [
            ...getNodes().map(n => ({ ...n, selected: false })),
            ...clones,
          ]
          const postEdges = [...getEdges(), ...clonedEdges]

          snapshot(postNodes, postEdges)
          setNodes(postNodes)
          setEdges(postEdges)

          console.log(`[Paste] ${clones.length} nodes, ${clonedEdges.length} edges`)
        }
      }
      // Shift+R — swap first two input connections on selected node
      if (e.shiftKey && e.key === 'R' && !e.ctrlKey && !e.metaKey && !e.altKey && !inInput) {
        e.preventDefault()
        const allNodes = getNodes()
        const selected = allNodes.filter(n => n.selected)
        console.log('[Shift+R] selected:', selected.length, 'nodes')
        if (selected.length === 1) {
          const node = selected[0]
          const allEdges = getEdges()
          const incomingEdges = allEdges.filter(ed => ed.target === node.id)
          if (incomingEdges.length < 2) break
          // Use first two incoming edges sorted by targetHandle name
          const sorted = [...incomingEdges].sort((a, b) => (a.targetHandle ?? '').localeCompare(b.targetHandle ?? ''))
          const edge1 = sorted[0]
          const edge2 = sorted[1]
          const postEdges = allEdges.map(ed => {
            if (ed.id === edge1.id) return { ...ed, targetHandle: edge2.targetHandle }
            if (ed.id === edge2.id) return { ...ed, targetHandle: edge1.targetHandle }
            return ed
          })
          snapshot(allNodes, postEdges)
          setEdges(postEdges)
        }
      }
      // Backspace — plain delete (no reconnection)
      if (e.key === 'Backspace' && !inInput) {
        const selNodes = getNodes().filter(n => n.selected)
        const selEdges = getEdges().filter(ed => ed.selected)
        if (selNodes.length > 0 || selEdges.length > 0) {
          e.preventDefault()
          const delNodeIds = new Set(selNodes.map(n => n.id))
          const delEdgeIds = new Set(selEdges.map(ed => ed.id))
          const postEdges = getEdges().filter(ed =>
            !delEdgeIds.has(ed.id) &&
            !delNodeIds.has(ed.source) &&
            !delNodeIds.has(ed.target) &&
            !((ed.data as Record<string, unknown>)?._bypassOf && delNodeIds.has((ed.data as Record<string, unknown>)._bypassOf as string))
          )
          const postNodes = selNodes.length > 0
            ? getNodes().filter(n => !delNodeIds.has(n.id))
            : getNodes()
          snapshot(postNodes, postEdges)
          setEdges(postEdges)
          setNodes(postNodes)
          if (selNodes.length > 0) cleanupNodeMedia(selNodes)
        }
      }
      // Delete — ungroup selected group nodes; delete non-group nodes with edge reconnection
      if (e.key === 'Delete' && !e.shiftKey && !inInput) {
        const selNodes = getNodes().filter(n => n.selected)
        const selEdges = getEdges().filter(ed => ed.selected)

        if (selNodes.length > 0 || selEdges.length > 0) {
          e.preventDefault()

          // Separate selected nodes into groups (to ungroup) and regular nodes (to delete)
          const selGroups = selNodes.filter(n => n.type === 'group')
          const selNonGroups = selNodes.filter(n => n.type !== 'group')

          // Ungroup any selected group nodes first (keep their children)
          if (selGroups.length > 0) {
            const groupIds = new Set(selGroups.map(g => g.id))
            const allNodesNow = getNodes()
            const updatedForUngroup = allNodesNow
              .filter(n => !groupIds.has(n.id))
              .map(n => {
                if (!n.parentId || !groupIds.has(n.parentId)) return n
                const parent = selGroups.find(g => g.id === n.parentId)
                if (!parent) return n
                const parentAbs = getAbsolutePosition(parent, allNodesNow)
                return {
                  ...n,
                  parentId: parent.parentId,
                  extent: parent.parentId ? ('parent' as const) : undefined,
                  position: {
                    x: n.position.x + parentAbs.x - (parent.parentId ? getAbsolutePosition(allNodesNow.find(pp => pp.id === parent.parentId)!, allNodesNow).x : 0),
                    y: n.position.y + parentAbs.y - (parent.parentId ? getAbsolutePosition(allNodesNow.find(pp => pp.id === parent.parentId)!, allNodesNow).y : 0),
                  },
                }
              })
            snapshot(updatedForUngroup, getEdges())
            setNodes(updatedForUngroup)
            // If there are also non-group nodes selected, deselect them to avoid stale state
            if (selNonGroups.length > 0) {
              setNodes(ns => ns.map(n => selNonGroups.some(sn => sn.id === n.id) ? { ...n, selected: false } : n))
            }
            return
          }

          // No groups selected — delete non-group nodes with edge reconnection
          const delEdgeIds = new Set(selEdges.map(ed => ed.id))
          const delNodeIds = new Set(selNonGroups.map(n => n.id))
          // Also remove any bypass edges associated with deleted nodes
          const edgesAfterDirectDelete = getEdges().filter(ed =>
            !delEdgeIds.has(ed.id) &&
            !((ed.data as Record<string, unknown>)?._bypassOf && delNodeIds.has((ed.data as Record<string, unknown>)._bypassOf as string))
          )
          const reconnects: { source: string; sourceHandle: string | null; target: string; targetHandle: string | null; style?: Record<string, unknown> }[] = []
          for (const node of selNonGroups) {
            const incoming = edgesAfterDirectDelete.filter(ed => ed.target === node.id)
            const outgoing = edgesAfterDirectDelete.filter(ed => ed.source === node.id)
            for (const inc of incoming) {
              for (const out of outgoing) {
                if (!delNodeIds.has(inc.source) && !delNodeIds.has(out.target)) {
                  reconnects.push({
                    source: inc.source,
                    sourceHandle: inc.sourceHandle ?? null,
                    target: out.target,
                    targetHandle: out.targetHandle ?? null,
                    style: edgeStyle(inc.sourceHandle),
                  })
                }
              }
            }
          }
          const postNodes = selNonGroups.length > 0
            ? getNodes().filter(n => !delNodeIds.has(n.id))
            : getNodes()
          let postEdges = edgesAfterDirectDelete.filter(ed =>
            !delNodeIds.has(ed.source) &&
            !delNodeIds.has(ed.target)
          )
          for (const ne of reconnects) {
            postEdges = enforceOneEdgePerInput(postEdges, ne.target, ne.targetHandle, postNodes)
            postEdges = addEdge(ne, postEdges)
          }

          snapshot(postNodes, postEdges)
          setEdges(postEdges)
          setNodes(postNodes)
          if (selNonGroups.length > 0) cleanupNodeMedia(selNonGroups)
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [groupSelected, ungroupSelected, getNodes, getEdges, setNodes, setEdges, snapshot, screenToFlowPosition, fitView, toggleAddMenu, toggleMinimap, toggleFullscreenBrowser])

  return { onNodeDragStart, handleStopAll }
}
