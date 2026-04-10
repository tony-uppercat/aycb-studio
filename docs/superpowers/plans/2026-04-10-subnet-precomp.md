# Subnet / Pre-Comp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Houdini-style subnet / AE pre-comp node for AYCB Studio v2: a black-box container with its own input/output pins, editable via a dive-in canvas replacement with breadcrumb navigation.

**Architecture:** Three new React Flow node types (`subnet`, `subnet-input`, `subnet-output`). A subnet stores its children inline as `data.sub_graph: { nodes, edges, viewport }`. Navigation state lives in a new ephemeral Zustand store. `FlowCanvas` switches from uncontrolled `useNodesState` to project-tree-backed state with a path-aware resolver. Pull-based execution gets subnet-aware branches in `useDataPropagation.ts`.

**Tech Stack:** React 19, TypeScript 5.9, @xyflow/react v12, Zustand 5, vitest + @testing-library/react, jsdom.

**Reference spec:** `docs/superpowers/specs/2026-04-10-subnet-precomp-design.md`

**Commit policy:** Per project rule (feedback memory `feedback_no_micro_commits.md`): **no per-task commits**. Finish the full feature, run all tests, then commit in one batch. Tasks below include test-verification steps but no `git commit` steps.

---

## File Structure

### New files (14)

```
frontend/src/stores/subnetPathStore.ts                       (~60 lines)
frontend/src/stores/subnetPathStore.test.ts                  (~60 lines)

frontend/src/hooks/subnetTreeHelpers.ts                      (~120 lines)  - pure helpers
frontend/src/hooks/subnetTreeHelpers.test.ts                 (~150 lines)
frontend/src/hooks/useActiveSubGraph.ts                      (~90 lines)   - React hook

frontend/src/nodes/subnet-input/
  node.manifest.ts                                           (~18 lines)
  SubnetInputNode.tsx                                        (~70 lines)
  subnet-input.test.ts                                       (~60 lines)

frontend/src/nodes/subnet-output/
  node.manifest.ts                                           (~18 lines)
  SubnetOutputNode.tsx                                        (~70 lines)
  subnet-output.test.ts                                      (~60 lines)

frontend/src/nodes/subnet/
  node.manifest.ts                                           (~18 lines)
  SubnetNode.tsx                                             (~180 lines)
  SubnetNode.module.css                                      (~100 lines)
  useSubnetPins.ts                                           (~70 lines)   - updateSubnetPins helper
  useSubnetPins.test.ts                                      (~90 lines)
  subnet.test.ts                                             (~80 lines)

frontend/src/components/canvas/BreadcrumbBar.tsx             (~80 lines)
frontend/src/components/canvas/BreadcrumbBar.module.css      (~60 lines)
frontend/src/components/canvas/BreadcrumbBar.test.tsx        (~80 lines)
```

### Modified files (3)

- `frontend/src/components/canvas/FlowCanvas.tsx` — replace `useNodesState`/`useEdgesState` with `useActiveSubGraph`-backed state; include `current_path` in `<ReactFlow>` key; host `BreadcrumbBar`; wire dive-in double-click + Esc listener; wire delete auto-exit
- `frontend/src/hooks/useDataPropagation.ts` — extend `resolveSource` chain to handle `subnet` and `subnet-input` source types via tree walker
- `frontend/src/hooks/useCanvasPersistence.ts` — make `serializeNodes()` recurse into `data.sub_graph.nodes` when `node.type === 'subnet'`

### Rules to respect (from CLAUDE.md)

- Max 300 lines per file. Plan the split at 250. `SubnetNode.tsx` is the biggest risk.
- New node = new folder in `frontend/src/nodes/` with `node.manifest.ts`. Auto-discovery handles registry.
- Data fields: `snake_case` for all NEW code. Existing `SlotDef.handleId` stays (legacy).
- No emoji in UI. Lucide icons + plain text.
- Don't modify files you weren't asked to touch.

---

## Phase 1 — Foundation

Build the ephemeral navigation store and pure tree helpers BEFORE any React or component work. These are testable in isolation.

### Task 1: subnetPathStore (Zustand)

**Files:**
- Create: `frontend/src/stores/subnetPathStore.ts`
- Test: `frontend/src/stores/subnetPathStore.test.ts`

- [ ] **Step 1.1: Write failing test**

Create `frontend/src/stores/subnetPathStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useSubnetPathStore } from './subnetPathStore'

describe('subnetPathStore', () => {
  beforeEach(() => {
    useSubnetPathStore.getState().reset()
  })

  it('starts empty (at root)', () => {
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })

  it('enter pushes subnet id onto path', () => {
    useSubnetPathStore.getState().enter('subnet-a')
    expect(useSubnetPathStore.getState().current_path).toEqual(['subnet-a'])
    useSubnetPathStore.getState().enter('subnet-b')
    expect(useSubnetPathStore.getState().current_path).toEqual(['subnet-a', 'subnet-b'])
  })

  it('exit pops one level', () => {
    useSubnetPathStore.getState().enter('subnet-a')
    useSubnetPathStore.getState().enter('subnet-b')
    useSubnetPathStore.getState().exit()
    expect(useSubnetPathStore.getState().current_path).toEqual(['subnet-a'])
  })

  it('exit at root is a no-op', () => {
    useSubnetPathStore.getState().exit()
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })

  it('goto truncates path to given depth', () => {
    useSubnetPathStore.getState().enter('a')
    useSubnetPathStore.getState().enter('b')
    useSubnetPathStore.getState().enter('c')
    useSubnetPathStore.getState().goto(1)
    expect(useSubnetPathStore.getState().current_path).toEqual(['a'])
  })

  it('goto(0) is equivalent to reset', () => {
    useSubnetPathStore.getState().enter('a')
    useSubnetPathStore.getState().goto(0)
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })

  it('goto with out-of-range depth is a no-op', () => {
    useSubnetPathStore.getState().enter('a')
    useSubnetPathStore.getState().goto(5)
    expect(useSubnetPathStore.getState().current_path).toEqual(['a'])
    useSubnetPathStore.getState().goto(-1)
    expect(useSubnetPathStore.getState().current_path).toEqual(['a'])
  })

  it('reset clears the path', () => {
    useSubnetPathStore.getState().enter('a')
    useSubnetPathStore.getState().enter('b')
    useSubnetPathStore.getState().reset()
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })
})
```

- [ ] **Step 1.2: Run test — expect failure**

```bash
cd frontend && npx vitest run src/stores/subnetPathStore.test.ts
```

Expected: FAIL with "Cannot find module './subnetPathStore'".

- [ ] **Step 1.3: Write implementation**

Create `frontend/src/stores/subnetPathStore.ts`:

```typescript
import { create } from 'zustand'

export interface SubnetPathState {
  /** Array of subnet node ids from root to current level. Empty = root canvas. */
  current_path: string[]
  /** Push a subnet id onto the path (dive-in). */
  enter: (subnet_id: string) => void
  /** Pop the deepest level (up one). No-op at root. */
  exit: () => void
  /** Truncate path to given depth. goto(0) = root. Out-of-range = no-op. */
  goto: (depth: number) => void
  /** Clear the path. Called on project switch. */
  reset: () => void
}

export const useSubnetPathStore = create<SubnetPathState>((set) => ({
  current_path: [],
  enter: (subnet_id) => set((s) => ({ current_path: [...s.current_path, subnet_id] })),
  exit: () => set((s) => ({ current_path: s.current_path.slice(0, -1) })),
  goto: (depth) => set((s) => {
    if (depth < 0 || depth > s.current_path.length) return s
    return { current_path: s.current_path.slice(0, depth) }
  }),
  reset: () => set({ current_path: [] }),
}))
```

- [ ] **Step 1.4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/stores/subnetPathStore.test.ts
```

Expected: 8 passing.

---

### Task 2: Tree walker helpers (pure functions)

**Files:**
- Create: `frontend/src/hooks/subnetTreeHelpers.ts`
- Test: `frontend/src/hooks/subnetTreeHelpers.test.ts`

Provides:
- `findNodePathInTree(root_nodes, target_id)` — DFS, returns path as array of subnet ids, or null
- `resolveLevel(root_nodes, path)` — returns `{ nodes, edges, viewport }` at that depth
- `updateNodesAtPath(root_nodes, path, updater)` — structural-sharing update of nodes at given depth
- `updateEdgesAtPath(root_nodes, path, updater)` — same for edges
- `updateViewportAtPath(root_nodes, path, viewport)` — same for viewport

These are pure functions. No React. No Zustand.

- [ ] **Step 2.1: Write failing test**

Create `frontend/src/hooks/subnetTreeHelpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import {
  findNodePathInTree,
  resolveLevel,
  updateNodesAtPath,
  updateEdgesAtPath,
  updateViewportAtPath,
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
    // root edges are returned via the helper result, not modified in tree
    // (edges at root are stored outside the tree)
    expect(new_edges.root_edges).toHaveLength(1)
  })

  it('updates nested sub_graph edges', () => {
    const tree: Node[] = [make_subnet('s1', [], [])]
    const new_edges = updateEdgesAtPath(tree, [], ['s1'], () => [{ id: 'e1', source: 'a', target: 'b' }])
    const inner_edges = (new_edges.new_tree[0].data as any).sub_graph.edges
    expect(inner_edges).toHaveLength(1)
  })
})

describe('updateViewportAtPath', () => {
  it('stores viewport at nested path', () => {
    const tree: Node[] = [make_subnet('s1')]
    const new_vp = { x: 100, y: 50, zoom: 1.5 }
    const updated = updateViewportAtPath(tree, ['s1'], new_vp)
    expect((updated[0].data as any).sub_graph.viewport).toEqual(new_vp)
  })
})
```

- [ ] **Step 2.2: Run test — expect failure**

```bash
cd frontend && npx vitest run src/hooks/subnetTreeHelpers.test.ts
```

Expected: FAIL.

- [ ] **Step 2.3: Write implementation**

Create `frontend/src/hooks/subnetTreeHelpers.ts`:

```typescript
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
 * Store a viewport at the given nested path. Path must be non-empty
 * (root viewport lives outside the tree).
 */
export function updateViewportAtPath(
  root_nodes: Node[],
  path: string[],
  viewport: Viewport,
): Node[] {
  if (path.length === 0) return root_nodes // caller should handle root viewport separately
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
```

- [ ] **Step 2.4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/hooks/subnetTreeHelpers.test.ts
```

Expected: all tests passing.

---

### Task 3: useActiveSubGraph hook

**Files:**
- Create: `frontend/src/hooks/useActiveSubGraph.ts`

Thin React hook that binds `subnetPathStore` + the root tree state to return the active level's nodes/edges + path-aware setters. Root state is injected by the caller (FlowCanvas owns it via `useState`).

- [ ] **Step 3.1: Write implementation**

Create `frontend/src/hooks/useActiveSubGraph.ts`:

```typescript
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
  /** Store the viewport at the current level (root viewport handled separately). */
  setViewportAtActive: (viewport: Viewport) => void
}

interface RootState {
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

  const { nodes, edges, viewport } = useMemo(
    () => {
      if (current_path.length === 0) {
        return { nodes: root.root_nodes, edges: root.root_edges, viewport: root.root_viewport }
      }
      return resolveLevel(root.root_nodes, root.root_edges, current_path)
    },
    [root.root_nodes, root.root_edges, root.root_viewport, current_path],
  )

  const setNodesAtActive = useCallback(
    (updater: (nodes: Node[]) => Node[]) => {
      if (current_path.length === 0) {
        root.setRootNodes(updater(root.root_nodes))
      } else {
        root.setRootNodes(updateNodesAtPath(root.root_nodes, current_path, updater))
      }
    },
    [current_path, root],
  )

  const setEdgesAtActive = useCallback(
    (updater: (edges: Edge[]) => Edge[]) => {
      if (current_path.length === 0) {
        root.setRootEdges(updater(root.root_edges))
      } else {
        const result = updateEdgesAtPath(root.root_nodes, root.root_edges, current_path, updater)
        root.setRootNodes(result.new_tree)
      }
    },
    [current_path, root],
  )

  const setViewportAtActive = useCallback(
    (vp: Viewport) => {
      if (current_path.length === 0) {
        root.setRootViewport(vp)
      } else {
        root.setRootNodes(updateViewportAtPath(root.root_nodes, current_path, vp))
      }
    },
    [current_path, root],
  )

  return { nodes, edges, viewport, setNodesAtActive, setEdgesAtActive, setViewportAtActive }
}
```

- [ ] **Step 3.2: Verify import compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

---

## Phase 2 — Proxy nodes

Build the two simplest proxy nodes first. They have no execution logic yet (wired in Phase 5).

### Task 4: subnet-input node

**Files:**
- Create: `frontend/src/nodes/subnet-input/node.manifest.ts`
- Create: `frontend/src/nodes/subnet-input/SubnetInputNode.tsx`
- Test: `frontend/src/nodes/subnet-input/subnet-input.test.ts`

- [ ] **Step 4.1: Write failing manifest test**

Create `frontend/src/nodes/subnet-input/subnet-input.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

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
  })

  it('defaults include handle_id, name, slot_type', () => {
    const d = manifest.defaultData
    expect(d).toHaveProperty('handle_id')
    expect(d).toHaveProperty('name')
    expect(d).toHaveProperty('slot_type')
    expect(d.slot_type).toBe('text')
  })
})
```

- [ ] **Step 4.2: Run test — expect failure**

```bash
cd frontend && npx vitest run src/nodes/subnet-input/subnet-input.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 4.3: Write manifest**

Create `frontend/src/nodes/subnet-input/node.manifest.ts`:

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'subnet-input',
  label: 'Subnet Input',
  icon: 'CornerRightDown', // Lucide icon name
  category: 'utility',
  description: 'Proxy input pin for a subnet — forwards data from the parent level',
  defaultData: {
    handle_id: '',      // filled on insert via updateSubnetPins
    name: 'input',
    slot_type: 'text',  // user-selectable
  },
  inputs: [],
  outputs: [{ type: 'text', handleId: 'out' }],
}
export default manifest
```

- [ ] **Step 4.4: Write minimal component**

Create `frontend/src/nodes/subnet-input/SubnetInputNode.tsx`:

```typescript
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'

interface SubnetInputData {
  handle_id: string
  name: string
  slot_type: 'text' | 'image' | 'video' | 'prompt' | 'media'
  result?: unknown
}

export default memo(function SubnetInputNode({ id, data }: NodeProps) {
  const d = data as unknown as SubnetInputData
  return (
    <NodeShell id={id} title={`> ${d.name || 'input'}`} manifestType="subnet-input">
      <div style={{ fontSize: 11, color: '#a1a1aa', padding: '4px 8px' }}>
        {d.slot_type}
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  )
})
```

- [ ] **Step 4.5: Run test — expect pass**

```bash
cd frontend && npx vitest run src/nodes/subnet-input/subnet-input.test.ts
```

Expected: 4 passing.

---

### Task 5: subnet-output node

**Files:**
- Create: `frontend/src/nodes/subnet-output/node.manifest.ts`
- Create: `frontend/src/nodes/subnet-output/SubnetOutputNode.tsx`
- Test: `frontend/src/nodes/subnet-output/subnet-output.test.ts`

Mirror of Task 4, but with an input handle and no output.

- [ ] **Step 5.1: Write failing test**

Create `frontend/src/nodes/subnet-output/subnet-output.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('subnet-output manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('subnet-output')
    expect(manifest.label).toBe('Subnet Output')
    expect(manifest.category).toBe('utility')
  })

  it('has one input handle', () => {
    expect(manifest.inputs).toHaveLength(1)
  })

  it('has no outputs (proxy is a sink)', () => {
    expect(manifest.outputs).toHaveLength(0)
  })

  it('defaults include handle_id, name, slot_type', () => {
    const d = manifest.defaultData
    expect(d).toHaveProperty('handle_id')
    expect(d).toHaveProperty('name')
    expect(d.slot_type).toBe('text')
  })
})
```

- [ ] **Step 5.2: Run test — expect failure**

```bash
cd frontend && npx vitest run src/nodes/subnet-output/subnet-output.test.ts
```

- [ ] **Step 5.3: Write manifest**

Create `frontend/src/nodes/subnet-output/node.manifest.ts`:

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'subnet-output',
  label: 'Subnet Output',
  icon: 'CornerRightUp',
  category: 'utility',
  description: 'Proxy output pin for a subnet — forwards data to the parent level',
  defaultData: {
    handle_id: '',
    name: 'output',
    slot_type: 'text',
  },
  inputs: [{ type: 'text', handleId: 'in' }],
  outputs: [],
}
export default manifest
```

- [ ] **Step 5.4: Write component**

Create `frontend/src/nodes/subnet-output/SubnetOutputNode.tsx`:

```typescript
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'

interface SubnetOutputData {
  handle_id: string
  name: string
  slot_type: 'text' | 'image' | 'video' | 'prompt' | 'media'
  result?: unknown
}

export default memo(function SubnetOutputNode({ id, data }: NodeProps) {
  const d = data as unknown as SubnetOutputData
  return (
    <NodeShell id={id} title={`${d.name || 'output'} >`} manifestType="subnet-output">
      <Handle type="target" position={Position.Left} id="in" />
      <div style={{ fontSize: 11, color: '#a1a1aa', padding: '4px 8px' }}>
        {d.slot_type}
      </div>
    </NodeShell>
  )
})
```

- [ ] **Step 5.5: Run test — expect pass**

```bash
cd frontend && npx vitest run src/nodes/subnet-output/subnet-output.test.ts
```

Expected: 4 passing.

---

### Task 6: updateSubnetPins helper

**Files:**
- Create: `frontend/src/nodes/subnet/useSubnetPins.ts`
- Test: `frontend/src/nodes/subnet/useSubnetPins.test.ts`

Pure helper that scans a sub_graph for proxy nodes and rebuilds the `external_inputs` / `external_outputs` lists for a subnet. Sorted by the y-position of the proxy on the internal canvas.

- [ ] **Step 6.1: Write failing test**

Create `frontend/src/nodes/subnet/useSubnetPins.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { buildSubnetPins } from './useSubnetPins'

function make_proxy(
  type: 'subnet-input' | 'subnet-output',
  id: string,
  handle_id: string,
  name: string,
  slot_type: string,
  y: number,
): Node {
  return {
    id,
    type,
    position: { x: 0, y },
    data: { handle_id, name, slot_type },
  }
}

describe('buildSubnetPins', () => {
  it('extracts inputs and outputs from sub_graph', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h1', 'prompt', 'text', 10),
      make_proxy('subnet-output', 'o1', 'h2', 'result', 'image', 30),
      make_proxy('subnet-input', 'i2', 'h3', 'image', 'image', 50),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_inputs).toHaveLength(2)
    expect(result.external_outputs).toHaveLength(1)
  })

  it('sorts inputs by y-position (top to bottom)', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h1', 'second', 'text', 50),
      make_proxy('subnet-input', 'i2', 'h2', 'first', 'text', 10),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_inputs.map((p) => p.name)).toEqual(['first', 'second'])
  })

  it('sorts outputs by y-position', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-output', 'o1', 'h1', 'bottom', 'text', 100),
      make_proxy('subnet-output', 'o2', 'h2', 'top', 'text', 5),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_outputs.map((p) => p.name)).toEqual(['top', 'bottom'])
  })

  it('ignores non-proxy nodes', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'h1', 'in', 'text', 10),
      { id: 'llm', type: 'llm', position: { x: 0, y: 20 }, data: {} },
      make_proxy('subnet-output', 'o1', 'h2', 'out', 'text', 30),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_inputs).toHaveLength(1)
    expect(result.external_outputs).toHaveLength(1)
  })

  it('preserves handle_id, name, slot_type on each pin', () => {
    const sub_nodes: Node[] = [
      make_proxy('subnet-input', 'i1', 'my-handle', 'prompt', 'text', 10),
    ]
    const result = buildSubnetPins(sub_nodes)
    expect(result.external_inputs[0]).toEqual({
      handle_id: 'my-handle',
      name: 'prompt',
      slot_type: 'text',
    })
  })

  it('returns empty arrays for empty sub_graph', () => {
    const result = buildSubnetPins([])
    expect(result.external_inputs).toEqual([])
    expect(result.external_outputs).toEqual([])
  })
})
```

- [ ] **Step 6.2: Run test — expect failure**

```bash
cd frontend && npx vitest run src/nodes/subnet/useSubnetPins.test.ts
```

- [ ] **Step 6.3: Write implementation**

Create `frontend/src/nodes/subnet/useSubnetPins.ts`:

```typescript
import type { Node } from '@xyflow/react'
import type { SlotType } from '../_shared/types'

export interface SubnetPin {
  handle_id: string
  name: string
  slot_type: SlotType
}

interface ProxyData {
  handle_id: string
  name: string
  slot_type: SlotType
}

/**
 * Scan a sub_graph's nodes and extract the proxy definitions into pin lists.
 * Inputs come from subnet-input nodes, outputs from subnet-output nodes.
 * Each list is sorted by the y-position of the proxy on the canvas (top-down).
 */
export function buildSubnetPins(sub_nodes: Node[]): {
  external_inputs: SubnetPin[]
  external_outputs: SubnetPin[]
} {
  const inputs: Array<{ pin: SubnetPin; y: number }> = []
  const outputs: Array<{ pin: SubnetPin; y: number }> = []

  for (const node of sub_nodes) {
    const data = node.data as unknown as ProxyData
    const pin: SubnetPin = {
      handle_id: data.handle_id,
      name: data.name,
      slot_type: data.slot_type,
    }
    const y = node.position.y
    if (node.type === 'subnet-input') inputs.push({ pin, y })
    else if (node.type === 'subnet-output') outputs.push({ pin, y })
  }

  inputs.sort((a, b) => a.y - b.y)
  outputs.sort((a, b) => a.y - b.y)

  return {
    external_inputs: inputs.map((x) => x.pin),
    external_outputs: outputs.map((x) => x.pin),
  }
}
```

- [ ] **Step 6.4: Run test — expect pass**

```bash
cd frontend && npx vitest run src/nodes/subnet/useSubnetPins.test.ts
```

Expected: 6 passing.

---

## Phase 3 — Subnet container node

### Task 7: subnet node skeleton

**Files:**
- Create: `frontend/src/nodes/subnet/node.manifest.ts`
- Create: `frontend/src/nodes/subnet/SubnetNode.tsx`
- Create: `frontend/src/nodes/subnet/SubnetNode.module.css`
- Test: `frontend/src/nodes/subnet/subnet.test.ts`

Minimal skeleton: renders with name header and dynamic handles derived from `data.external_inputs` / `data.external_outputs`. No dive-in yet.

- [ ] **Step 7.1: Write failing manifest test**

Create `frontend/src/nodes/subnet/subnet.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import manifest from './node.manifest'

describe('subnet manifest', () => {
  it('has required fields', () => {
    expect(manifest.type).toBe('subnet')
    expect(manifest.label).toBe('Subnet')
    expect(manifest.category).toBe('utility')
  })

  it('has empty inputs/outputs (dynamic from proxies)', () => {
    expect(manifest.inputs).toEqual([])
    expect(manifest.outputs).toEqual([])
  })

  it('defaultData contains an empty sub_graph', () => {
    const d = manifest.defaultData as any
    expect(d.sub_graph).toBeDefined()
    expect(d.sub_graph.nodes).toEqual([])
    expect(d.sub_graph.edges).toEqual([])
    expect(d.sub_graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(d.external_inputs).toEqual([])
    expect(d.external_outputs).toEqual([])
  })

  it('defaultData has default name and color', () => {
    const d = manifest.defaultData as any
    expect(d.name).toBe('Subnet')
    expect(d.color).toBeNull()
    expect(d.collapsed).toBe(false)
  })
})
```

- [ ] **Step 7.2: Write manifest**

Create `frontend/src/nodes/subnet/node.manifest.ts`:

```typescript
import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'subnet',
  label: 'Subnet',
  icon: 'Box',
  category: 'utility',
  description: 'Black-box container with nested sub-graph and explicit I/O pins',
  defaultData: {
    name: 'Subnet',
    color: null,
    collapsed: false,
    sub_graph: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    external_inputs: [],
    external_outputs: [],
  },
  inputs: [],
  outputs: [],
}
export default manifest
```

- [ ] **Step 7.3: Write component**

Create `frontend/src/nodes/subnet/SubnetNode.tsx`:

```typescript
import { memo, useCallback } from 'react'
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react'
import { CornerDownRight } from 'lucide-react'
import { useSubnetPathStore } from '../../stores/subnetPathStore'
import styles from './SubnetNode.module.css'
import type { SubnetPin } from './useSubnetPins'

interface SubnetData {
  name: string
  color: string | null
  collapsed: boolean
  external_inputs: SubnetPin[]
  external_outputs: SubnetPin[]
}

export default memo(function SubnetNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as SubnetData
  const enter = useSubnetPathStore((s) => s.enter)

  const handleDiveIn = useCallback(() => {
    enter(id)
  }, [enter, id])

  return (
    <div
      className={styles.subnet}
      style={{ borderColor: d.color ?? '#F52776' }}
      onDoubleClick={handleDiveIn}
      data-testid={`subnet-${id}`}
    >
      <NodeResizer minWidth={120} minHeight={80} isVisible={selected} />
      <div className={styles.header}>{d.name}</div>

      {/* Dynamic input handles from external_inputs */}
      {d.external_inputs.map((pin, i) => (
        <div
          key={pin.handle_id}
          className={styles.inputRow}
          style={{ top: 28 + i * 20 }}
        >
          <Handle type="target" position={Position.Left} id={pin.handle_id} />
          <span className={styles.pinLabel}>{pin.name}</span>
        </div>
      ))}

      {/* Dynamic output handles */}
      {d.external_outputs.map((pin, i) => (
        <div
          key={pin.handle_id}
          className={styles.outputRow}
          style={{ top: 28 + i * 20 }}
        >
          <span className={styles.pinLabel}>{pin.name}</span>
          <Handle type="source" position={Position.Right} id={pin.handle_id} />
        </div>
      ))}

      <div className={styles.diveHint} aria-hidden>
        <CornerDownRight size={14} strokeWidth={1.5} />
      </div>
    </div>
  )
})
```

- [ ] **Step 7.4: Write CSS**

Create `frontend/src/nodes/subnet/SubnetNode.module.css`:

```css
.subnet {
  background: rgba(245, 39, 118, 0.04);
  border: 1.5px solid #F52776;
  border-radius: 6px;
  min-width: 120px;
  min-height: 80px;
  position: relative;
  color: #fafafa;
  font-family: system-ui, sans-serif;
  cursor: default;
}

.header {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border-bottom: 1px solid rgba(245, 39, 118, 0.3);
  background: rgba(245, 39, 118, 0.08);
  border-radius: 5px 5px 0 0;
}

.inputRow,
.outputRow {
  position: absolute;
  display: flex;
  align-items: center;
  font-size: 10px;
  color: #a1a1aa;
  pointer-events: none;
}

.inputRow {
  left: -2px;
  padding-left: 12px;
}

.outputRow {
  right: -2px;
  padding-right: 12px;
  flex-direction: row-reverse;
}

.pinLabel {
  padding: 0 6px;
}

.diveHint {
  position: absolute;
  right: 6px;
  bottom: 4px;
  color: #F52776;
  opacity: 0.6;
  pointer-events: none;
}
```

- [ ] **Step 7.5: Run test — expect pass**

```bash
cd frontend && npx vitest run src/nodes/subnet/subnet.test.ts
```

Expected: 4 passing.

---

## Phase 4 — Canvas integration

### Task 8: BreadcrumbBar component

**Files:**
- Create: `frontend/src/components/canvas/BreadcrumbBar.tsx`
- Create: `frontend/src/components/canvas/BreadcrumbBar.module.css`
- Test: `frontend/src/components/canvas/BreadcrumbBar.test.tsx`

Reads `current_path` from `subnetPathStore`. Hidden when path is empty. Shows clickable segments.

- [ ] **Step 8.1: Write failing test**

Create `frontend/src/components/canvas/BreadcrumbBar.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Node } from '@xyflow/react'
import { useSubnetPathStore } from '../../stores/subnetPathStore'
import { BreadcrumbBar } from './BreadcrumbBar'

function make_subnet(id: string, name: string): Node {
  return {
    id,
    type: 'subnet',
    position: { x: 0, y: 0 },
    data: { name, sub_graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } },
  }
}

describe('BreadcrumbBar', () => {
  beforeEach(() => useSubnetPathStore.getState().reset())
  afterEach(() => useSubnetPathStore.getState().reset())

  it('renders nothing when path is empty', () => {
    const { container } = render(<BreadcrumbBar root_nodes={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders one segment for depth 1', () => {
    const tree = [make_subnet('s1', 'Style Transfer')]
    useSubnetPathStore.getState().enter('s1')
    render(<BreadcrumbBar root_nodes={tree} />)
    expect(screen.getByText('Style Transfer')).toBeInTheDocument()
  })

  it('renders multiple segments for nested path', () => {
    const inner = make_subnet('s2', 'Color Grading')
    ;(inner.data as any).sub_graph.nodes = []
    const outer = make_subnet('s1', 'Style Transfer')
    ;(outer.data as any).sub_graph.nodes = [inner]
    useSubnetPathStore.getState().enter('s1')
    useSubnetPathStore.getState().enter('s2')
    render(<BreadcrumbBar root_nodes={[outer]} />)
    expect(screen.getByText('Style Transfer')).toBeInTheDocument()
    expect(screen.getByText('Color Grading')).toBeInTheDocument()
  })

  it('clicking root resets the path', () => {
    const tree = [make_subnet('s1', 'S1')]
    useSubnetPathStore.getState().enter('s1')
    render(<BreadcrumbBar root_nodes={tree} />)
    fireEvent.click(screen.getByText('/'))
    expect(useSubnetPathStore.getState().current_path).toEqual([])
  })

  it('clicking an intermediate segment calls goto(depth)', () => {
    const inner = make_subnet('s2', 'S2')
    ;(inner.data as any).sub_graph.nodes = []
    const outer = make_subnet('s1', 'S1')
    ;(outer.data as any).sub_graph.nodes = [inner]
    useSubnetPathStore.getState().enter('s1')
    useSubnetPathStore.getState().enter('s2')
    render(<BreadcrumbBar root_nodes={[outer]} />)
    fireEvent.click(screen.getByText('S1'))
    expect(useSubnetPathStore.getState().current_path).toEqual(['s1'])
  })
})
```

- [ ] **Step 8.2: Run test — expect failure**

```bash
cd frontend && npx vitest run src/components/canvas/BreadcrumbBar.test.tsx
```

- [ ] **Step 8.3: Write implementation**

Create `frontend/src/components/canvas/BreadcrumbBar.tsx`:

```typescript
import { useMemo } from 'react'
import type { Node } from '@xyflow/react'
import { useSubnetPathStore } from '../../stores/subnetPathStore'
import styles from './BreadcrumbBar.module.css'

interface Props {
  root_nodes: Node[]
}

interface Segment {
  id: string
  name: string
  depth: number
}

function build_segments(root_nodes: Node[], path: string[]): Segment[] {
  const result: Segment[] = []
  let level: Node[] = root_nodes
  for (let i = 0; i < path.length; i++) {
    const subnet = level.find((n) => n.id === path[i])
    if (!subnet) break
    const data = subnet.data as any
    result.push({ id: subnet.id, name: data.name || subnet.id, depth: i + 1 })
    level = data.sub_graph?.nodes ?? []
  }
  return result
}

export function BreadcrumbBar({ root_nodes }: Props) {
  const current_path = useSubnetPathStore((s) => s.current_path)
  const goto = useSubnetPathStore((s) => s.goto)
  const reset = useSubnetPathStore((s) => s.reset)

  const segments = useMemo(() => build_segments(root_nodes, current_path), [root_nodes, current_path])

  if (current_path.length === 0) return null

  return (
    <div className={styles.bar}>
      <button className={styles.seg} onClick={reset} type="button">/</button>
      {segments.map((seg, i) => {
        const is_last = i === segments.length - 1
        return (
          <span key={seg.id} className={styles.group}>
            <span className={styles.sep}>&rsaquo;</span>
            <button
              className={is_last ? `${styles.seg} ${styles.active}` : styles.seg}
              onClick={() => goto(seg.depth - 1 === i ? seg.depth : seg.depth)}
              type="button"
              disabled={is_last}
            >
              {seg.name}
            </button>
          </span>
        )
      })}
      <span className={styles.hint}>Esc to exit</span>
    </div>
  )
}
```

Correction for the goto logic: clicking a segment should navigate to the level ABOVE that segment. Adjust: `onClick={() => goto(i + 1)}` where `i + 1` is the new depth. Or clicking segment at index i means "be at depth i+1". But to navigate UP to this segment, we set depth = i+1. And clicking the last segment (the current level) is a no-op (disabled).

Update the onClick line to:

```typescript
onClick={() => goto(i + 1)}
```

- [ ] **Step 8.4: Write CSS**

Create `frontend/src/components/canvas/BreadcrumbBar.module.css`:

```css
.bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  background: #111113;
  border-bottom: 1px solid #27272a;
  font-size: 12px;
  font-family: system-ui, sans-serif;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  height: 28px;
}

.group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.seg {
  background: transparent;
  border: none;
  color: #71717a;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
}

.seg:hover:not(:disabled) {
  background: #18181b;
  color: #fafafa;
}

.seg.active {
  color: #F52776;
  font-weight: 600;
  cursor: default;
}

.sep {
  color: #3f3f46;
}

.hint {
  margin-left: auto;
  font-size: 10px;
  color: #52525b;
  font-family: 'JetBrains Mono', Consolas, monospace;
}
```

- [ ] **Step 8.5: Run test — expect pass**

```bash
cd frontend && npx vitest run src/components/canvas/BreadcrumbBar.test.tsx
```

Expected: 5 passing.

---

### Task 9: FlowCanvas integration

**Files:**
- Modify: `frontend/src/components/canvas/FlowCanvas.tsx`

This is the biggest structural change. Replace `useNodesState`/`useEdgesState` with a root tree state + `useActiveSubGraph` bridge. Keep the legacy `const [nodes, setNodes, onNodesChange] = useNodesState(...)` hook for compat only if needed — preferred: full switch to controlled mode.

**Plan:**

1. Replace `const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])` and the edge equivalent with:

```typescript
const [rootNodes, setRootNodes] = useState<Node[]>([])
const [rootEdges, setRootEdges] = useState<Edge[]>([])
const [rootViewport, setRootViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
const current_path = useSubnetPathStore((s) => s.current_path)
const active = useActiveSubGraph({
  root_nodes: rootNodes, root_edges: rootEdges, root_viewport: rootViewport,
  setRootNodes, setRootEdges, setRootViewport,
})
const nodes = active.nodes
const edges = active.edges
const setNodes = (updater: any) =>
  active.setNodesAtActive(typeof updater === 'function' ? updater : () => updater)
const setEdges = (updater: any) =>
  active.setEdgesAtActive(typeof updater === 'function' ? updater : () => updater)
const onNodesChange = useCallback(
  (changes: any) => active.setNodesAtActive((ns) => applyNodeChanges(changes, ns)),
  [active],
)
const onEdgesChange = useCallback(
  (changes: any) => active.setEdgesAtActive((es) => applyEdgeChanges(changes, es)),
  [active],
)
```

Import `applyNodeChanges`, `applyEdgeChanges` from `@xyflow/react`.

2. Load from IndexedDB fills `rootNodes` / `rootEdges` (not `setNodes`).

3. Add BreadcrumbBar above the `<ReactFlow>` element:

```tsx
<BreadcrumbBar root_nodes={rootNodes} />
<ReactFlow
  key={current_path.join('/')}
  nodes={nodes}
  edges={edges}
  onNodesChange={onNodesChange}
  ...
/>
```

4. Esc key handler in FlowCanvas (or add to `useKeyboardShortcuts`):

```typescript
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    // Ignore when a contenteditable/input is focused (rename)
    const active_el = document.activeElement
    if (active_el instanceof HTMLElement && (
      active_el.isContentEditable ||
      active_el.tagName === 'INPUT' ||
      active_el.tagName === 'TEXTAREA'
    )) return
    const path = useSubnetPathStore.getState().current_path
    if (path.length > 0) useSubnetPathStore.getState().exit()
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [])
```

5. Reset path when active project changes:

```typescript
useEffect(() => {
  useSubnetPathStore.getState().reset()
}, [activeProject?.id])
```

6. Auto-exit when current subnet is deleted:

```typescript
useEffect(() => {
  const path = useSubnetPathStore.getState().current_path
  if (path.length === 0) return
  const last_id = path[path.length - 1]
  const found = findNodePathInTree(rootNodes, last_id)
  if (found === null) {
    useSubnetPathStore.getState().exit()
  }
}, [rootNodes])
```

7. Update `useCanvasHistory` wiring. The hook today reads via `getNodes`/`getEdges` from `useReactFlow()` — which after the refactor returns the ACTIVE level's nodes/edges, not the full tree. Undo must capture the full tree so a change inside a subnet can be undone from the root. Change the wiring to pass root-level getters:

```typescript
const getRootNodesRef = useCallback(() => rootNodes, [rootNodes])
const getRootEdgesRef = useCallback(() => rootEdges, [rootEdges])
const { snapshot, undo, redo, resetHistory, onDragStop: historyDragStop } = useCanvasHistory(
  getRootNodesRef,
  getRootEdgesRef,
  setRootNodes,
  setRootEdges,
  { nodes: [], edges: [] },
)
```

This keeps `useCanvasHistory` unchanged internally; it just operates on the root tree now. Undo/redo restores the full nested state and the breadcrumb path rehydrates because `resolveLevel` reads from the restored root.

- [ ] **Step 9.1: Read FlowCanvas.tsx top-to-bottom**

```bash
cd frontend && wc -l src/components/canvas/FlowCanvas.tsx
```

Read the file to understand where to make surgical changes. The target is to:
- Replace the `useNodesState`/`useEdgesState` block
- Add the BreadcrumbBar render
- Add the Esc + delete-exit effects
- Include `current_path` in the ReactFlow key

- [ ] **Step 9.2: Apply the refactor**

(Concrete inline code is above in the plan. Apply to FlowCanvas.tsx section by section, keeping existing hooks like `useCanvasHistory`, `useCanvasPersistence`, etc. untouched wherever possible.)

- [ ] **Step 9.3: Run existing FlowCanvas-related tests**

```bash
cd frontend && npx vitest run
```

Expected: zero regressions. If `useCanvasHistory` relies on `getNodes` / `getEdges` from `useReactFlow()`, that still works because React Flow is still rendered and tracks its own view. But the project-source-of-truth is now `rootNodes`/`rootEdges`.

- [ ] **Step 9.4: Smoke test manually**

```bash
cd frontend && npm run dev
```

Browser: load a project, verify nothing broke, add a Subnet node from the menu, verify it renders.

---

## Phase 5 — Execution & data flow

### Task 10: Resolver changes in useDataPropagation.ts

**Files:**
- Modify: `frontend/src/hooks/useDataPropagation.ts`

Add subnet-aware resolution as a NEW branch at the top of the existing `resolveSource` function. Keep existing bypass chain logic intact.

- [ ] **Step 10.1: Read the current resolveSource function**

Already read above. It takes `sourceId, handleId, getNodes, getEdges, depth`.

- [ ] **Step 10.2: Update to handle subnet source types**

Modify `frontend/src/hooks/useDataPropagation.ts` — at the top of `resolveSource`, after fetching `node`, add:

```typescript
function resolveSource(sourceId: string, handleId: string, getNodes: () => Node[], getEdges: () => Edge[], depth = 0): Node | null {
  if (depth > 20) return null
  const node = getNodes().find(n => n.id === sourceId)
  if (!node) return null
  const d = node.data as Record<string, unknown>

  // --- NEW: subnet source → walk into sub_graph for the output proxy ---
  if (node.type === 'subnet') {
    const sub_graph = d.sub_graph as { nodes: Node[] } | undefined
    if (!sub_graph) return null
    const proxy = sub_graph.nodes.find(
      (n) => n.type === 'subnet-output' && (n.data as any).handle_id === handleId,
    )
    return proxy ?? null  // caller reads proxy.data.result via existing fallback
  }

  // --- NEW: subnet-input source → already resolved in its onRun, just return self ---
  if (node.type === 'subnet-input') {
    return node
  }

  if (!d._bypassed) return node
  const incoming = getEdges().find(e => e.target === sourceId)
  if (!incoming) return null
  return resolveSource(incoming.source, handleId, getNodes, getEdges, depth + 1)
}
```

And in `pullText` / `pullMedia`, the fallback reads need to check `d.result`. `pullText` already reads `d.outputText`, but for proxies we need `d.result`. Update the final return line in `pullText`:

```typescript
return (d.outputText as string) || (d.text as string) || (d.prompt as string) || (d.result as string) || ''
```

And `pullMedia` similarly checks `d.result` as a File fallback:

```typescript
if (!file && d.result instanceof File) {
  file = d.result
}
```

- [ ] **Step 10.3: Add a test for the subnet resolver branch**

Create `frontend/src/hooks/useDataPropagation.test.ts` (new file — first test for this module):

```typescript
import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { pullText } from './useDataPropagation'

describe('pullText with subnet source', () => {
  it('reads proxy.data.result from subnet-output inside subnet', () => {
    const inner_proxy: Node = {
      id: 'proxy-out',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: { handle_id: 'result', name: 'result', slot_type: 'text', result: 'hello from subnet' },
    }
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'Subnet',
        sub_graph: { nodes: [inner_proxy], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        external_outputs: [{ handle_id: 'result', name: 'result', slot_type: 'text' }],
      },
    }
    const reader: Node = {
      id: 'reader',
      type: 'result-viewer',
      position: { x: 0, y: 0 },
      data: {},
    }
    const edges: Edge[] = [
      { id: 'e1', source: 'sub-1', sourceHandle: 'result', target: 'reader', targetHandle: 'in' },
    ]
    const nodes = [subnet, reader]
    const result = pullText('reader', 'in', () => nodes, () => edges)
    expect(result).toBe('hello from subnet')
  })

  it('returns empty string when subnet-output proxy has no cached result', () => {
    const inner_proxy: Node = {
      id: 'proxy-out',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: { handle_id: 'result', name: 'result', slot_type: 'text' },
    }
    const subnet: Node = {
      id: 'sub-1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        sub_graph: { nodes: [inner_proxy], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    }
    const reader: Node = { id: 'reader', type: 'result-viewer', position: { x: 0, y: 0 }, data: {} }
    const edges: Edge[] = [
      { id: 'e1', source: 'sub-1', sourceHandle: 'result', target: 'reader', targetHandle: 'in' },
    ]
    const result = pullText('reader', 'in', () => [subnet, reader], () => edges)
    expect(result).toBe('')
  })
})
```

- [ ] **Step 10.4: Run test**

```bash
cd frontend && npx vitest run src/hooks/useDataPropagation.test.ts
```

Expected: 2 passing.

---

### Task 11: subnet-output.onRun wiring

**Files:**
- Modify: `frontend/src/nodes/subnet-output/SubnetOutputNode.tsx`

The proxy becomes runnable. On run, it pulls from its input handle and caches the value in `data.result`. Use `registerNodeRun` pattern from existing nodes.

- [ ] **Step 11.1: Read `NodeShell.tsx` lines 97-160 to understand registerNodeRun**

(Read existing code to see how other nodes wire up `onRun`.)

- [ ] **Step 11.2: Update SubnetOutputNode.tsx to register onRun**

```typescript
import { memo, useCallback, useEffect } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { pullText, pullMedia } from '../../hooks/useDataPropagation'
import { registerNodeRun, unregisterNodeRun } from '../../utils/cascadeRun'

interface SubnetOutputData {
  handle_id: string
  name: string
  slot_type: 'text' | 'image' | 'video' | 'prompt' | 'media'
  result?: unknown
}

export default memo(function SubnetOutputNode({ id, data }: NodeProps) {
  const d = data as unknown as SubnetOutputData
  const { getNodes, getEdges, setNodes } = useReactFlow()

  const onRun = useCallback(async () => {
    let value: unknown
    if (d.slot_type === 'text' || d.slot_type === 'prompt') {
      value = pullText(id, 'in', getNodes, getEdges)
    } else {
      const media = await pullMedia(id, 'in', getNodes, getEdges)
      value = media.file ?? media.mediaId ?? null
    }
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, result: value } } : n)),
    )
  }, [id, d.slot_type, getNodes, getEdges, setNodes])

  useEffect(() => {
    registerNodeRun(id, onRun)
    return () => unregisterNodeRun(id)
  }, [id, onRun])

  return (
    <NodeShell id={id} title={`${d.name || 'output'} >`} manifestType="subnet-output" onRun={onRun}>
      <Handle type="target" position={Position.Left} id="in" />
      <div style={{ fontSize: 11, color: '#a1a1aa', padding: '4px 8px' }}>
        {d.slot_type}
      </div>
    </NodeShell>
  )
})
```

**Important:** at the subnet level, `getNodes()` / `getEdges()` return the ACTIVE sub_graph (since React Flow is focused on the sub_graph when we're inside the subnet). This is correct for the output proxy's input — it reads from a sibling internal node.

- [ ] **Step 11.3: Run existing tests**

```bash
cd frontend && npx vitest run src/nodes/subnet-output/
```

Expected: manifest tests still pass. Additional unit test for run behavior is optional (can be covered in Phase 8 E2E).

---

### Task 12: subnet-input.onRun wiring

**Files:**
- Modify: `frontend/src/nodes/subnet-input/SubnetInputNode.tsx`

The proxy's `onRun` walks up one level in the tree, finds the external edge on the parent subnet's pin with matching `handle_id`, reads the upstream source, and caches the value.

- [ ] **Step 12.1: Update SubnetInputNode.tsx**

```typescript
import { memo, useCallback, useEffect } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { NodeShell } from '../_shared/NodeShell'
import { registerNodeRun, unregisterNodeRun } from '../../utils/cascadeRun'
import { findNodePathInTree, resolveLevel } from '../../hooks/subnetTreeHelpers'
// Access root tree via a shared hook or via the parent canvas context.
// The simplest approach: expose a module-level getter that FlowCanvas populates.
import { getRootTree } from '../../hooks/rootTreeGetter'

interface SubnetInputData {
  handle_id: string
  name: string
  slot_type: 'text' | 'image' | 'video' | 'prompt' | 'media'
  result?: unknown
}

export default memo(function SubnetInputNode({ id, data }: NodeProps) {
  const d = data as unknown as SubnetInputData
  const { setNodes } = useReactFlow()

  const onRun = useCallback(async () => {
    const { root_nodes, root_edges } = getRootTree()
    const own_path = findNodePathInTree(root_nodes, id)
    if (!own_path || own_path.length === 0) return
    const parent_subnet_id = own_path[own_path.length - 1]
    const parent_level_path = own_path.slice(0, -1)
    const parent_level = resolveLevel(root_nodes, root_edges, parent_level_path)
    const edge = parent_level.edges.find(
      (e) => e.target === parent_subnet_id && e.targetHandle === d.handle_id,
    )
    if (!edge) return
    const source = parent_level.nodes.find((n) => n.id === edge.source)
    if (!source) return
    // Read the source's output data — reuse the same logic as pullText
    const src_data = source.data as Record<string, unknown>
    const value =
      (src_data.outputText as string) ||
      (src_data.text as string) ||
      (src_data.result as string) ||
      null
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, result: value } } : n)),
    )
  }, [id, d.handle_id, setNodes])

  useEffect(() => {
    registerNodeRun(id, onRun)
    return () => unregisterNodeRun(id)
  }, [id, onRun])

  return (
    <NodeShell id={id} title={`> ${d.name || 'input'}`} manifestType="subnet-input" onRun={onRun}>
      <div style={{ fontSize: 11, color: '#a1a1aa', padding: '4px 8px' }}>
        {d.slot_type}
      </div>
      <Handle type="source" position={Position.Right} id="out" />
    </NodeShell>
  )
})
```

- [ ] **Step 12.2: Create `rootTreeGetter.ts`**

Create `frontend/src/hooks/rootTreeGetter.ts`:

```typescript
import type { Node, Edge } from '@xyflow/react'

/**
 * Simple module-level bridge so node components at any depth can access the
 * root project tree. FlowCanvas calls `setRootTree` whenever rootNodes/rootEdges change.
 */
let _root_nodes: Node[] = []
let _root_edges: Edge[] = []

export function setRootTree(nodes: Node[], edges: Edge[]): void {
  _root_nodes = nodes
  _root_edges = edges
}

export function getRootTree(): { root_nodes: Node[]; root_edges: Edge[] } {
  return { root_nodes: _root_nodes, root_edges: _root_edges }
}
```

- [ ] **Step 12.3: Call setRootTree from FlowCanvas**

In `FlowCanvas.tsx`, inside the component body:

```typescript
useEffect(() => {
  setRootTree(rootNodes, rootEdges)
}, [rootNodes, rootEdges])
```

Import `setRootTree` at the top.

- [ ] **Step 12.4: Run tests**

```bash
cd frontend && npx vitest run
```

Expected: all still passing.

---

### Task 13: subnet.onRun (cascade internal outputs)

**Files:**
- Modify: `frontend/src/nodes/subnet/SubnetNode.tsx`

When the user clicks Run on a subnet node from outside, this triggers `subnet.onRun` which must run each internal `subnet-output` proxy's cascade. That in turn walks back through the internal graph to the `subnet-input` proxies.

However: cascade operates at a single React Flow level. The subnet's internal graph is not the current React Flow level (unless the user is inside the subnet). So we need a way to "cascade" nodes that aren't currently in `getNodes()`.

**Pragmatic v1 approach:** Instead of a full cross-level cascade, `subnet.onRun` manually iterates `sub_graph.nodes` in topological order and calls each node's registered `onRun`. Each proxy's `onRun` uses `getRootTree()` to find its own position and read from external sources — so it works regardless of which React Flow level is currently focused.

For internal non-proxy nodes (like `llm`), they expect `getNodes()` to return their sub_graph, which it DOESN'T when running from outside. So these nodes will fail to read upstream sources.

**Simpler v1 approach:** Require the user to dive into the subnet to run it. `subnet.onRun` from the outside only does the minimum: if any proxy outputs are already cached, it re-caches them into its own `external_outputs` state. Otherwise, it shows a toast: "Dive into the subnet to run it first."

**Chosen approach: explicit dive-to-run.**

Update SubnetNode.tsx to register an onRun that simply displays a console message instructing the user to dive in, unless all proxies already have cached results.

- [ ] **Step 13.1: Add onRun to SubnetNode**

In SubnetNode.tsx:

```typescript
import { registerNodeRun, unregisterNodeRun } from '../../utils/cascadeRun'

// ... inside component
const onRun = useCallback(() => {
  // v1: the user must dive into the subnet to run its internals.
  // External run just checks if proxy caches are populated.
  const sub = (data as any).sub_graph
  if (!sub) return
  const outputs = (sub.nodes as any[]).filter((n) => n.type === 'subnet-output')
  const uncached = outputs.filter((p) => p.data.result === undefined || p.data.result === null)
  if (uncached.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[subnet ${id}] ${uncached.length} output(s) have no cached result. Dive in and run to populate.`)
  }
}, [id, data])

useEffect(() => {
  registerNodeRun(id, onRun)
  return () => unregisterNodeRun(id)
}, [id, onRun])
```

Note: the warning goes to the browser console for now. A toast integration can come later.

- [ ] **Step 13.2: Verify tests still pass**

```bash
cd frontend && npx vitest run
```

---

## Phase 6 — Persistence

### Task 14: Recursive serializeNodes

**Files:**
- Modify: `frontend/src/hooks/useCanvasPersistence.ts`

- [ ] **Step 14.1: Write a test**

Create `frontend/src/hooks/useCanvasPersistence.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { serializeNodes } from './useCanvasPersistence'

describe('serializeNodes — subnet recursion', () => {
  it('strips result from proxy nodes inside a subnet', () => {
    const proxy: Node = {
      id: 'p1',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: { handle_id: 'h1', name: 'out', slot_type: 'text', result: 'cached value' },
    }
    const subnet: Node = {
      id: 's1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'S',
        sub_graph: { nodes: [proxy], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    }
    const serialized = serializeNodes([subnet])
    const inner = ((serialized[0].data as any).sub_graph.nodes[0].data as any)
    expect(inner.result).toBeUndefined()
    expect(inner.handle_id).toBe('h1') // non-stripped fields preserved
  })

  it('strips result from deeply nested proxies', () => {
    const deep_proxy: Node = {
      id: 'p2',
      type: 'subnet-output',
      position: { x: 0, y: 0 },
      data: { handle_id: 'h2', name: 'x', slot_type: 'text', result: 'deep' },
    }
    const inner_subnet: Node = {
      id: 's2',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'inner',
        sub_graph: { nodes: [deep_proxy], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    }
    const outer: Node = {
      id: 's1',
      type: 'subnet',
      position: { x: 0, y: 0 },
      data: {
        name: 'outer',
        sub_graph: { nodes: [inner_subnet], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      },
    }
    const serialized = serializeNodes([outer])
    const deep = ((((serialized[0].data as any).sub_graph.nodes[0].data as any).sub_graph.nodes[0].data as any))
    expect(deep.result).toBeUndefined()
  })

  it('preserves non-subnet nodes unchanged', () => {
    const plain: Node = {
      id: 'a',
      type: 'prompt-editor',
      position: { x: 0, y: 0 },
      data: { text: 'hello' },
    }
    const serialized = serializeNodes([plain])
    expect((serialized[0].data as any).text).toBe('hello')
  })
})
```

- [ ] **Step 14.2: Update serializeNodes to recurse**

Modify `frontend/src/hooks/useCanvasPersistence.ts`. In the existing `serializeNodes` function, before the final `return clean as Node`, add the recursive step for subnet types:

```typescript
// Recurse into sub_graph.nodes if this is a subnet container
if (n.type === 'subnet' && data.sub_graph && typeof data.sub_graph === 'object') {
  const sg = data.sub_graph as { nodes?: Node[]; edges?: unknown; viewport?: unknown }
  data.sub_graph = {
    nodes: serializeNodes((sg.nodes ?? []) as Node[]),
    edges: sg.edges ?? [],
    viewport: sg.viewport ?? { x: 0, y: 0, zoom: 1 },
  }
}
```

Add it right before `clean.data = data`.

Also add `result` to `LARGE_DATA_KEYS` so that proxy `data.result` is stripped automatically at every level. It's already there — verify and adjust if needed.

- [ ] **Step 14.3: Run tests**

```bash
cd frontend && npx vitest run src/hooks/useCanvasPersistence.test.ts
```

Expected: 3 passing.

---

## Phase 7 — Polish & edge cases

### Task 15: Context menu — Add Subnet Input/Output

**Files:**
- Modify: `frontend/src/components/canvas/CanvasContextMenu.tsx`

Add two new entries to the context menu, visible ONLY when `current_path.length > 0` (i.e., user is inside a subnet). Clicking inserts a new proxy node at the click position.

- [ ] **Step 15.1: Locate current context menu structure**

```bash
cd frontend && wc -l src/components/canvas/CanvasContextMenu.tsx
```

Read the relevant section to understand the menu item structure.

- [ ] **Step 15.2: Add conditional menu items**

Inside `CanvasContextMenu.tsx`, add:

```typescript
import { useSubnetPathStore } from '../../stores/subnetPathStore'

// Inside the component body:
const inside_subnet = useSubnetPathStore((s) => s.current_path.length > 0)

// Inside the menu render, add when inside_subnet is true:
{inside_subnet && (
  <>
    <MenuItem onClick={() => onInsertProxy('subnet-input')}>Add Subnet Input</MenuItem>
    <MenuItem onClick={() => onInsertProxy('subnet-output')}>Add Subnet Output</MenuItem>
  </>
)}
```

The `onInsertProxy` handler lives in FlowCanvas and creates a new node at the click position, then calls `buildSubnetPins` + updates the parent subnet's `external_inputs/outputs` cache.

- [ ] **Step 15.3: Implement onInsertProxy in FlowCanvas**

```typescript
import { buildSubnetPins } from '../../nodes/subnet/useSubnetPins'
import { updateNodesAtPath } from '../../hooks/subnetTreeHelpers'
import { getNextNodeId } from '../../hooks/useCanvasDragDrop'

const onInsertProxy = useCallback(
  (proxy_type: 'subnet-input' | 'subnet-output') => {
    if (!ctxMenu?.flowPos) return
    const path = useSubnetPathStore.getState().current_path
    if (path.length === 0) return
    const parent_subnet_id = path[path.length - 1]
    const parent_level_path = path.slice(0, -1)

    const new_id = getNextNodeId(proxy_type)
    const handle_id = `h-${new_id}`
    const new_node: Node = {
      id: new_id,
      type: proxy_type,
      position: ctxMenu.flowPos,
      data: {
        handle_id,
        name: proxy_type === 'subnet-input' ? 'input' : 'output',
        slot_type: 'text',
      },
    }

    // 1. Add the proxy to the current sub_graph
    active.setNodesAtActive((ns) => [...ns, new_node])

    // 2. Rebuild external_inputs/outputs on the parent subnet
    setRootNodes((prev) =>
      updateNodesAtPath(prev, parent_level_path, (siblings) =>
        siblings.map((s) => {
          if (s.id !== parent_subnet_id) return s
          const sub_nodes = [...(s.data as any).sub_graph.nodes, new_node]
          const { external_inputs, external_outputs } = buildSubnetPins(sub_nodes)
          return {
            ...s,
            data: { ...s.data, external_inputs, external_outputs },
          }
        }),
      ),
    )
    setCtxMenu(null)
  },
  [ctxMenu, active],
)
```

**Note:** There's a redundancy — `active.setNodesAtActive` already writes to the tree at the current path, and then we call `updateNodesAtPath` with the parent path to update the pins. These could be merged into a single update to avoid a double render. Acceptable for v1.

- [ ] **Step 15.4: Test manually**

```bash
cd frontend && npm run dev
```

Add a subnet, dive in, right-click, verify "Add Subnet Input/Output" appears, click it, verify proxy appears + parent subnet shows the new pin on exit.

---

### Task 16: Pin sync on proxy rename/delete

**Files:**
- Modify: `frontend/src/components/canvas/FlowCanvas.tsx`

When a proxy is renamed or deleted, the parent subnet's `external_inputs/outputs` must be rebuilt.

- [ ] **Step 16.1: Add a useEffect that watches active sub_graph changes**

In FlowCanvas, after the definition of `active`:

```typescript
// Whenever rootNodes change AND we're inside a subnet, rebuild the parent's pin cache
useEffect(() => {
  const path = useSubnetPathStore.getState().current_path
  if (path.length === 0) return
  const parent_subnet_id = path[path.length - 1]
  const parent_level_path = path.slice(0, -1)
  const current = resolveLevel(rootNodes, rootEdges, path)
  const { external_inputs, external_outputs } = buildSubnetPins(current.nodes)
  setRootNodes((prev) =>
    updateNodesAtPath(prev, parent_level_path, (siblings) =>
      siblings.map((s) => {
        if (s.id !== parent_subnet_id) return s
        return { ...s, data: { ...s.data, external_inputs, external_outputs } }
      }),
    ),
  )
  // Note: this can trigger an update loop if not careful. Use a deep-equal check
  // or only update when the pin arrays actually differ.
}, [rootNodes])
```

**Loop risk:** This effect updates rootNodes, which triggers itself. Add a diff check:

```typescript
const prev_inputs = JSON.stringify(parent_subnet.data.external_inputs ?? [])
const new_inputs = JSON.stringify(external_inputs)
if (prev_inputs === new_inputs && prev_outputs === new_outputs) return
```

Keep the effect tight.

- [ ] **Step 16.2: Manual smoke test**

Rename a proxy, verify the parent subnet's pin label updates on exit.

---

### Task 17: Nested depth soft-cap warning

**Files:**
- Modify: `frontend/src/components/canvas/BreadcrumbBar.tsx`

Show a warning banner when `current_path.length > 7`.

- [ ] **Step 17.1: Add warning to BreadcrumbBar**

```typescript
{current_path.length > 7 && (
  <span className={styles.warning}>Deep nesting — consider flattening</span>
)}
```

Add corresponding CSS:

```css
.warning {
  color: #eab308;
  font-size: 10px;
  margin-left: 10px;
  font-style: italic;
}
```

- [ ] **Step 17.2: Skip test for this polish item (trivial)**

---

## Phase 8 — Verification

### Task 18: Run full test suite

- [ ] **Step 18.1: Frontend tests**

```bash
cd frontend && npx vitest run
```

Expected: all tests passing. New tests added: ~30 (8 path store + 15 tree helpers + 4 subnet-input + 4 subnet-output + 6 subnet pins + 4 subnet manifest + 5 breadcrumb + 2 resolver + 3 persistence).

- [ ] **Step 18.2: Backend tests (regression check)**

```bash
python -m pytest
```

Expected: 150 passing (unchanged — no backend touched).

- [ ] **Step 18.3: TypeScript build**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 18.4: Production build**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

---

### Task 19: Manual E2E smoke test

- [ ] **Step 19.1: Launch the app**

Double-click `AYCB Studio.bat` on the desktop. Backend + frontend start.

- [ ] **Step 19.2: Create a new project**

Project gallery → new project.

- [ ] **Step 19.3: Add a Subnet from the node menu**

Drag a Subnet node onto the canvas. Verify:
- Border is accent pink
- Label says "Subnet"
- Small chevron icon bottom-right
- No pins visible (no proxies yet)

- [ ] **Step 19.4: Dive in**

Double-click the subnet. Verify:
- Canvas replaces with empty sub_graph view
- Breadcrumb bar appears at top showing `/ › Subnet`
- Escape key hint on the right

- [ ] **Step 19.5: Add proxy inputs**

Right-click the canvas → "Add Subnet Input". Verify a `Subnet Input` node appears. Rename it to "prompt". Right-click again, add another input named "image" with slot_type=image.

- [ ] **Step 19.6: Add an internal node and a proxy output**

Drag an LLM node onto the internal canvas. Connect `prompt` input proxy → LLM input. Right-click, add "Subnet Output", connect LLM output → subnet-output. Rename to "response".

- [ ] **Step 19.7: Exit the subnet**

Press Escape. Verify:
- Canvas returns to root
- Subnet node now shows pins `prompt`, `image` on left and `response` on right

- [ ] **Step 19.8: Wire external connections**

Add a Text Input node, wire it → subnet's `prompt` pin. Add a Result Viewer, wire subnet's `response` → Result Viewer.

- [ ] **Step 19.9: Run the subnet**

Dive back in, click Run on the LLM node (or Shift+Click on the subnet-output proxy to cascade). Verify the subnet-output cache populates.

- [ ] **Step 19.10: Verify external read**

Exit the subnet. Click Run on the Result Viewer. Verify it shows the cached response.

- [ ] **Step 19.11: Save + reload**

Wait for the save indicator to show "saved". Refresh the browser. Verify the project reloads with the subnet and its internals intact.

- [ ] **Step 19.12: Delete subnet while inside it**

Dive into a subnet. From an outside action (devtools or a parallel window), delete the subnet. Verify the breadcrumb auto-exits.

---

## Verification summary

| Check | Command | Expected |
|---|---|---|
| Frontend tests | `cd frontend && npx vitest run` | all passing |
| Backend tests | `python -m pytest` | 150 passing |
| TypeScript | `cd frontend && npx tsc --noEmit` | no errors |
| Build | `cd frontend && npm run build` | success |
| Post-edit tsc hook | automatic on every file save | passing |

After all checks green, commit as a single feature bundle per project rule (`feedback_no_micro_commits.md`):

```bash
git add frontend/src/stores/subnetPathStore.ts \
        frontend/src/stores/subnetPathStore.test.ts \
        frontend/src/hooks/subnetTreeHelpers.ts \
        frontend/src/hooks/subnetTreeHelpers.test.ts \
        frontend/src/hooks/useActiveSubGraph.ts \
        frontend/src/hooks/rootTreeGetter.ts \
        frontend/src/hooks/useDataPropagation.ts \
        frontend/src/hooks/useDataPropagation.test.ts \
        frontend/src/hooks/useCanvasPersistence.ts \
        frontend/src/hooks/useCanvasPersistence.test.ts \
        frontend/src/nodes/subnet/ \
        frontend/src/nodes/subnet-input/ \
        frontend/src/nodes/subnet-output/ \
        frontend/src/components/canvas/BreadcrumbBar.tsx \
        frontend/src/components/canvas/BreadcrumbBar.module.css \
        frontend/src/components/canvas/BreadcrumbBar.test.tsx \
        frontend/src/components/canvas/FlowCanvas.tsx \
        frontend/src/components/canvas/CanvasContextMenu.tsx \
        docs/superpowers/specs/2026-04-10-subnet-precomp-design.md \
        docs/superpowers/plans/2026-04-10-subnet-precomp.md

git commit -m "[feat] Subnet / pre-comp node — dive-in container with I/O proxies"
```

---

## Out of scope reminders (deferred to v2)

- Templates / cross-project reusability
- Dirty propagation and auto-invalidation when internal graph changes
- Parallel cross-boundary cascade optimization
- Bypass / pass-through mode on the subnet
- Import / export a subnet as standalone JSON
- Toast-based warning instead of console.warn for "dive in to run" message
- Run button on the external subnet face that walks into the sub_graph automatically
