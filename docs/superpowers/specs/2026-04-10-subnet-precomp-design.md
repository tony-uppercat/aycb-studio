# Subnet / Pre-Comp — Design Spec

**Date:** 2026-04-10
**Status:** Approved, ready for implementation plan

## Context

AYCB Studio v2 has a `group` node today: a visual container with React Flow parent/child (`parentId` + `extent: 'parent'`), collapse, lock, color, rename. But groups do **not** encapsulate — children stay visible on the main canvas and edges cross the group boundary freely. The handles on the group are decorative, no data routes through them.

The goal is a Houdini subnet / After Effects pre-comp: a **black-box container** whose sub-graph is hidden from the outer canvas, exposing only explicit input/output pins. Used for developing complex parts of a project in isolation without cluttering the top-level view.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Relationship to existing group | New separate node. Group stays unchanged. |
| Navigation | Dive-in: main canvas replaces with sub_graph contents; breadcrumb bar on top. |
| I/O schema | Proxy nodes inside (Houdini-style): `subnet-input`, `subnet-output`. |
| Reusability | Instance-local (v1). Templates deferred. |
| Implementation approach | Nested `sub_graph` inline in `subnet.data`. |
| Execution | Explicit run. Pull = cache read. No auto-trigger recursion. |

## Architecture

### Three new node types

- **`subnet`** — container. `data.sub_graph: { nodes, edges, viewport }`. Dynamic handles derived from internal proxy children.
- **`subnet-input`** — proxy inside a subnet. On run: walks up one level, finds the external edge on the parent subnet pin with matching `handle_id`, reads the upstream source, caches in `data.result`.
- **`subnet-output`** — proxy inside a subnet. On run: pulls from its input handle via normal `pullText`/`pullMedia`, caches in `data.result`.

### Navigation state

- **`subnetPathStore`** (Zustand, ephemeral — not persisted): `current_path: string[]`, plus `enter`, `exit`, `goto`, `reset`.
- **`BreadcrumbBar`** component above `<ReactFlow>`, hidden when `current_path` is empty. Click any segment to `goto(depth)`; click `/` to `reset()`.
- **Dive-in:** double-click a `subnet` node triggers `enter(node.id)`. Single click is normal selection. Contenteditable rename intercepts the double-click.
- **Exit:** `Esc` key or click any previous breadcrumb segment.

### Canvas source swap

- **`useActiveSubGraph`** hook resolves `current_path` into the active sub_graph, returning `{ nodes, edges, viewport, set_nodes, set_edges, set_viewport }`. Setters walk the same path and apply updates via immutable structural sharing.
- **`FlowCanvas`** reads from this hook as its source of truth instead of pulling nodes/edges directly from the project store.
- The `<ReactFlow>` element's `key` prop includes `current_path.join('/')` so a full remount happens on level change, resetting React Flow's internal state and avoiding drag artifacts.

## Data types

```typescript
interface SubnetNodeData {
  name: string
  color: string | null
  collapsed: boolean
  sub_graph: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
  external_inputs: SubnetPin[]    // derived cache, rebuilt by updateSubnetPins()
  external_outputs: SubnetPin[]   // derived cache, rebuilt by updateSubnetPins()
  last_preview_b64?: string       // runtime only, stripped at save
}

interface SubnetPin {
  handle_id: string   // stable id linked 1:1 to a proxy node inside sub_graph
  name: string        // UI label
  slot_type: SlotType // 'text' | 'image' | 'video' | 'prompt' | 'media'
}

interface SubnetInputNodeData {
  handle_id: string
  name: string
  slot_type: SlotType
}

interface SubnetOutputNodeData {
  handle_id: string
  name: string
  slot_type: SlotType
}

interface SubnetPathState {
  current_path: string[]
  enter: (subnet_id: string) => void
  exit: () => void
  goto: (depth: number) => void
  reset: () => void
}
```

All data fields use `snake_case` per rule #4 of `CLAUDE.md`.

## Execution model

**Principle:** proxies are real nodes with `onRun` + cached `data.result`. Pull operations read caches only, with zero side effects.

- **`subnet-input.onRun`:** walks up one level via `current_path`, finds the external edge on the parent subnet's pin with matching `handle_id`, resolves the upstream source, caches in `data.result`.
- **`subnet-output.onRun`:** pulls from its input handle using normal `pullText`/`pullMedia`, caches in `data.result`.
- **`subnet.onRun`:** iterates its internal `subnet-output` proxies and cascades each one (which recursively walks back to the `subnet-input` proxies).
- **Pull resolution (read-only):** when an external node reads from a subnet's output pin, the resolver finds the matching `subnet-output` proxy inside `sub_graph` and returns `proxy.data.result`. No auto-trigger, no recursion from the resolver.
- **Cascade crossing boundary:** when the cascade walker encounters a `subnet` as a source, it treats `subnet.onRun` as the run function — the same mechanism already used for any other node with a registered `onRun`.
- **Nested:** each level's `subnet.onRun` handles only its own `sub_graph`. Nesting works by induction.

Resolver changes in `useDataPropagation.ts`. `PullContext` carries the full project tree plus the current breadcrumb path; `getLevelContext(root_nodes, path)` walks the tree and returns the `{ nodes, edges }` at that depth (exported from `useActiveSubGraph.ts` and reused here).

```typescript
interface PullContext {
  root_nodes: Node[]
  current_path: string[]
}

function resolveSource(ctx: PullContext, source: Node, source_handle: string): SlotValue {
  if (source.type === 'subnet') {
    const proxy = source.data.sub_graph.nodes.find(
      n => n.type === 'subnet-output' && n.data.handle_id === source_handle
    )
    return proxy?.data.result ?? null
  }

  if (source.type === 'subnet-input') {
    const parent_path = ctx.current_path.slice(0, -1)
    const parent_subnet_id = ctx.current_path[ctx.current_path.length - 1]
    const outer = getLevelContext(ctx.root_nodes, parent_path)
    const edge = outer.edges.find(
      e => e.target === parent_subnet_id && e.targetHandle === source.data.handle_id
    )
    if (!edge) return null
    const outer_source = outer.nodes.find(n => n.id === edge.source)!
    return resolveSource({ ...ctx, current_path: parent_path }, outer_source, edge.sourceHandle!)
  }

  return source.data.outputText ?? source.data.result ?? null
}
```

**Deferred to v2:** dirty propagation, parallel cross-boundary cascade, bypass / pass-through mode, lazy evaluation.

## Serialization

- **`ProjectRecord` schema unchanged.** A subnet is a `Node` whose `data` happens to contain a nested `sub_graph`. IndexedDB schema is untouched.
- **`serializeNodes()` becomes recursive** in `useCanvasPersistence.ts`: when `node.type === 'subnet'`, it also recurses into `data.sub_graph.nodes` through the same function.
- **Stripped per level** (all depths): `measured`, `selected`, `dragging`, `result` (proxy caches), `analysisHistory`, `last_preview_b64`.
- **Load:** no extra work. After load, `updateSubnetPins(subnet_id)` is called for every discovered subnet to rebuild `external_inputs/outputs` from the proxy nodes.
- **Auto-discovery:** the three new node folders appear in `NODE_CATALOG` via `import.meta.glob` in `nodes/index.ts` — zero edits to the registry (rule #2 of `CLAUDE.md`).
- **Backwards compatibility:** existing projects have no subnet nodes → zero migration. New code handles them only when present.

## UX details

- **External subnet face:** compact node, border `var(--color-accent)` (#F52776), editable header name (contenteditable), dynamic handles from `external_inputs` on the left and `external_outputs` on the right, sorted by the y-position of the internal proxies.
- **Dive-in affordance:** Lucide `CornerDownRight` icon (16px, stroke 1.5) in the bottom-right corner. No emoji (rule #5).
- **Collapse / resize:** reuses React Flow `NodeResizer`. Min 120×80, max free.
- **Color:** 8-color picker component shared with the group node.
- **Context menu:** "Add Subnet Input" and "Add Subnet Output" visible only when `current_path` is non-empty (i.e. the user is already inside a subnet).
- **Nested soft-cap:** warning banner at depth 8. Not a hard block.
- **Paste into self:** blocked by a parent-path check when pasting a subnet whose source path is an ancestor of the target path.

## Files

### New (10)

```
frontend/src/nodes/subnet/
  node.manifest.ts
  SubnetNode.tsx
  SubnetNode.module.css
  types.ts
  useSubnetPins.ts
  subnet.test.ts

frontend/src/nodes/subnet-input/
  node.manifest.ts
  SubnetInputNode.tsx
  types.ts
  subnet-input.test.ts

frontend/src/nodes/subnet-output/
  node.manifest.ts
  SubnetOutputNode.tsx
  types.ts
  subnet-output.test.ts

frontend/src/stores/subnetPathStore.ts
frontend/src/components/canvas/BreadcrumbBar.tsx
frontend/src/components/canvas/BreadcrumbBar.module.css
frontend/src/hooks/useActiveSubGraph.ts
```

### Modified (3)

- `frontend/src/components/canvas/FlowCanvas.tsx` — read nodes/edges via `useActiveSubGraph`; include `current_path` in the `<ReactFlow>` key; host `BreadcrumbBar`.
- `frontend/src/hooks/useDataPropagation.ts` — resolver handles `subnet` and `subnet-input` source types via `resolveSource`.
- `frontend/src/hooks/useCanvasPersistence.ts` — make `serializeNodes()` recursive for subnet sub_graphs.

All new files must respect the 300-line cap (rule #1). `SubnetNode.tsx` is the biggest risk and should be split into sub-components early if it approaches 250 lines.

## Testing

### Unit

- `useActiveSubGraph` path resolver: root, 1-level, 3-level nested, invalid path
- `updateSubnetPins` proxy sync: add, remove, rename, reorder, handle_id stability
- `subnetPathStore`: enter / exit / goto / reset; out-of-range goto is a no-op
- `serializeNodes` recursive strip + round-trip through JSON

### Integration

- Dive-in then exit preserves canvas state
- Adding a `subnet-input` inside a subnet adds an external pin on the outer face
- Removing a proxy removes the pin and drops any dangling external edge
- Resolver walks cross-boundary: external read → proxy cache; `subnet-input` read → outer edge
- Deleting a subnet while inside it triggers auto-exit

### Manual E2E

1. Create a project with a 2-level nested subnet (root → subnet A → subnet B)
2. Wire text input → subnet A input → internal LLM → subnet A output → result viewer
3. Run the subnet, verify cache populates
4. Save, close project, reopen — state intact
5. Copy-paste a subnet: sub_graph duplicated with new node IDs

**Target:** ~25 new tests added; full suite (frontend + backend) green before merge.

## Verification

1. Frontend tests: `cd frontend && npx vitest run`
2. Backend tests: `python -m pytest` (should stay at 150 passing; no backend changes expected)
3. Build: `cd frontend && npm run build` — no errors
4. Manual smoke test using the E2E script above
5. Post-edit tsc hook (active per guardrails) must pass on every modified file

## Out of scope (v1)

- Templates / cross-project reusability
- Dirty propagation and auto-invalidation
- Parallel cross-boundary cascade optimization
- Bypass / pass-through mode
- Import / export a subnet as standalone JSON
- Negative pin types (conditional, dynamic count)
