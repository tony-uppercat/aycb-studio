# Subnet Feature Audit — 2026-04-19

Focused quality audit of the subnet (pre-comp) feature. Ousterhout
lens, same rubric as `2026-04-18-complexity-audit-v2.md` but scoped to
one subsystem.

## Scope

~1575 LOC of production code across 15 files + 99 tests across 9 test
files:

| Surface | File | LOC |
|---|---|---:|
| Node (black-box) | `nodes/subnet/SubnetNode.tsx` | 214 |
| Node (input proxy) | `nodes/subnet-input/SubnetInputNode.tsx` | 224 |
| Node (output proxy) | `nodes/subnet-output/SubnetOutputNode.tsx` | 156 |
| Editor modal | `components/canvas/SubnetEditor.tsx` | 252 |
| Path store | `stores/subnetPathStore.ts` | 38 |
| Tree helpers | `hooks/subnetTreeHelpers.ts` | 178 |
| Active-graph resolver | `hooks/useActiveSubGraph.ts` | 107 |
| Root snapshot | `hooks/rootTreeGetter.ts` | 36 |
| Pin builder | `nodes/subnet/useSubnetPins.ts` | 47 |
| snake-case util | `nodes/subnet/subnetUtils.ts` | 14 |
| 3 manifests | `**/node.manifest.ts` | 26 + 17 + 17 |

Zero file over 252 LOC. All under the CLAUDE.md-enforced 300-LOC cap.

## Executive Summary

**Grade: B+ (7.4 / 10)** — the subnet is the most carefully-architected
feature in the codebase. Pure helpers with dependency injection,
documented non-obvious decisions (e.g. plain module vs. Zustand for
`rootTreeGetter`), and thorough tests (99 across 9 files, including
failure paths: orphan proxy, missing parent edge, invalid path).

One **Critical bug** surfaces from the handle-id lifecycle gap: new
proxies ship with `handle_id: ''` from the manifest default and
nothing assigns a unique id on create → two proxies in the same
subnet would collide at the React handle, the `buildSubnetPins`
output, and edge routing. Likely unobserved so far because the user
testing pattern is "rename before connecting a second proxy".

No other Critical findings. Two Major items cover design debt that
doesn't break anything today but will bite on paste/duplicate of
subnets.

## Score Dashboard

| # | Dimension | Score | Status |
|---|-----------|-------|--------|
| 1 | Module Depth | 9/10 | Exceptional — helpers are deep |
| 2 | Information Hiding | 8/10 | Good — path/tree ops encapsulated |
| 3 | Abstraction Quality | 8/10 | Good — pure functions, named data |
| 4 | Complexity Indicators | 7/10 | Good — one known load-bearing ref |
| 5 | Error Handling | 8/10 | Good — explicit null on orphan / missing |
| 6 | Layering | 7/10 | Good — two dispatch paths (intentional) |
| 7 | Design Investment | 9/10 | Exceptional — pure helpers, tests, docblocks |
| 8 | Comments & Abstractions | 9/10 | Exceptional — every non-obvious call justified |
| 9 | Codebase Navigability | 8/10 | Good — folder structure mirrors data flow |
| 10 | Naming & Obviousness | 8/10 | Good — verbs precise; one colocation hiccup |
| 11 | Consistency | 7/10 | Good — CLAUDE.md rule 4 honored throughout |
| 12 | Software Trends Anti-Patterns | 6/10 | Adequate — one intentional module singleton |
| 13 | Performance-Design Relationship | 7/10 | Good — structural sharing, no unnecessary re-walks |
| | **Weighted Average** | **7.78** | **Grade: B+** |

Formula: `(core × 1.5 + structural × 1.2 + surface × 1.0) / 16`
= `(32 × 1.5 + 41 × 1.2 + 28 × 1.0) / 16` = `125.2 / 16` = **7.83**
(rounded).

## Findings

### Critical

| # | Dimension | Location | Issue |
|---|-----------|----------|-------|
| **SC1** | Lifecycle / Uniqueness | `components/canvas/SubnetEditor.tsx:174-188` + `nodes/subnet-input/node.manifest.ts:10` + `nodes/subnet-output/node.manifest.ts:10` | **`handle_id` never assigned on creation.** The manifest default is `handle_id: ''`, and `addNode()` spreads `manifest.defaultData` verbatim with no special case for subnet-input / subnet-output. `commitRename` only writes `name`. Result: every fresh proxy has `handle_id: ''`, so two proxies of the same direction in one subnet collide — `buildSubnetPins` emits duplicate pin ids, the SubnetNode renders two `<Handle id="">` (React key collision + DOM ambiguity), and edge routing in `buildInputOnRun` finds both or neither. Tests construct proxies with explicit `handle_id` so the gap is invisible from the test suite. |

### Major

| # | Dimension | Location | Issue |
|---|-----------|----------|-------|
| **SM1** | Global mutable state | `hooks/rootTreeGetter.ts` | Module-level `current` variable with `setRootTree` / `getRootTree` / `resetRootTree`. Justification in the docblock is reasonable (sync read inside `useCallback` without triggering renders) but the pattern is **inherently shared across tabs / component instances**. Two project tabs open in the same window would both write to the same singleton and race on reads. Works for single-session single-project use; will need refactoring (per-project tree + react context) when multi-tab or multi-user is supported. |
| **SM2** | Copy/paste semantics | `hooks/useKeyboardShortcuts.ts` (Ctrl+C / Ctrl+V paths) + `SubnetNode.tsx` | A user can copy a subnet with a populated `sub_graph`, but the paste path calls `cloneNodesAndEdges` which remaps the subnet node id — **it does NOT recurse into `sub_graph.nodes` to remap inner node ids**. Pasting a subnet twice would give you two subnets whose inner nodes share ids with each other and with the original. Edge lookups inside the pasted subnet would still resolve locally (sub_graphs are self-contained) so the failure mode is subtle: works until the user dives in with the outer path store, where shared ids could confuse the active-level resolver. No tests cover "paste subnet, dive into clone". |
| **SM3** | Save-loop in editor | `components/canvas/SubnetEditor.tsx:161-163` | `useEffect` writes `save_ref.current({nodes, edges, viewport})` on every `nodes / edges / viewport` change, including the initial mount. That means opening the editor writes the same sub_graph back to the outer state once immediately — a no-op update but a full `setNodes` pass that re-renders every root-level node. Cheap but measurable with many siblings; worth a `useEffect` deps guard or initial-skip flag. |

### Minor

| # | Dimension | Location | Issue |
|---|-----------|----------|-------|
| Ssm1 | DRY | `subnet-input/SubnetInputNode.tsx:82-88` + `subnet-output/SubnetOutputNode.tsx:41-46` | Both proxies have identical slot-type dispatch (`text`/`prompt` → `pullText`, else → `pullMedia`). Could factor into a tiny shared `pullBySlotType(slot_type, id, handle, getNodes, getEdges)` helper. |
| Ssm2 | Inline styles | `subnet-input/SubnetInputNode.tsx:144-218` | ~12 inline `style={{...}}` blocks on the Name / Slot Type controls. The rest of the codebase uses CSS modules. SubnetOutputNode uses `styles.promptInput` etc. from the shared Node module — the input proxy should match. |
| Ssm3 | Color hardcoded | `SubnetNode.tsx:124` | `borderColor = d.color ?? '#F52776'` — the accent token is inlined. Should read `var(--color-accent)` via CSS module to keep a single source of truth for the accent. |
| Ssm4 | Naming drift | `useSubnetPins.ts` lives in `nodes/subnet/` but exports a pure function, not a hook. `use*` prefix is misleading. Rename to `subnetPins.ts` or keep the hook convention by wrapping in `useMemo` at call sites. |
| Ssm5 | Redundant fallback | `SubnetNode.tsx:80-81` | `useMemo(() => d.external_inputs ?? [], [d.external_inputs])` — the `??` is a cheap operation that doesn't need memoization. React will re-create the empty array on every render but that's fine since it's only read by `.map`. Dead useMemo. |

## Design Strengths

- **Pure helpers extracted**: `pinsEqual`, `computePinPatch`, `applyRename`, `toggleCollapsed`, `applySubGraphUpdate`, `buildInputOnRun`, `buildOutputOnRun` are all 5-25 LOC pure functions with docblocks. Each testable in isolation — the test suite exploits this with explicit dependency injection (see `buildInputOnRun(id, getData, getRootTree, updateNodeData)`).
- **Structural sharing in tree mutations**: `updateNodesAtPath` and `updateEdgesAtPath` are recursive and use `root_nodes.map(n => ...)`, never mutating. Sibling branches keep their original references so React's ref-equality optimizations work.
- **Explicit null contract**: both proxies write `{ result: null }` when the external pin is disconnected or the proxy is orphaned. Downstream consumers can distinguish "no connection" from "empty string" — a common pitfall in graph editors.
- **Non-Zustand choice explained**: `rootTreeGetter.ts` uses a plain module singleton instead of Zustand, and the docblock states *why* (sync read from `useCallback`, no re-render trigger). This is the kind of "why, not what" comment Ousterhout calls out as load-bearing.
- **Rename draft pattern**: both proxies keep a local `draft` state so the user can type spaces/caps; the snake_case commit happens on blur. Preserves the "mental model of typing" without fighting the data constraint.
- **Esc-safe modal**: `SubnetEditor` skips Escape handling when focus is inside an INPUT / TEXTAREA / contentEditable, so renaming a proxy doesn't accidentally exit the editor. Small, thoughtful.
- **Failure-path coverage**: the test suite explicitly probes orphan proxies (no parent subnet), missing edge on this handle_id, invalid paths returning empty arrays. Contradicts the codebase-wide `feedback_test_failure_paths.md` complaint — subnet is the counter-example.
- **99 tests across 9 files** — highest ratio per-LOC in the codebase (~6%).

## Recommendations

Prioritized by impact / effort.

| # | Action | Effort | Unblocks |
|---|--------|--------|----------|
| **0** | **Assign `handle_id` on proxy creation** — in `SubnetEditor.addNode`, when `type === 'subnet-input'` or `'subnet-output'`, set `data.handle_id = \`pin-${Date.now()}-${Math.random().toString(36).slice(2,6)}\`` (or `nanoid(6)`). Add a regression test that adds two proxies and asserts their ids differ. | XS (10 min) | **SC1 fix.** Unblocks multi-proxy subnets. |
| 1 | Recursive id remap on subnet paste — `cloneNodesAndEdges` should detect `type === 'subnet'` nodes and recurse into `data.sub_graph.nodes`, rebuilding the oldToNew map per level. Add a test that pastes a subnet containing a sub-subnet and asserts all ids are unique. | S (1-2h) | SM2. |
| 2 | Skip initial save in editor — add a ref `did_mount` that flips true after the first render; the save effect skips while false. Saves one no-op `setNodes` pass on open. | XS (10 min) | SM3. |
| 3 | Factor `pullBySlotType` helper — 10 LOC shared between the two proxies. | XS (10 min) | Ssm1. |
| 4 | Migrate SubnetInputNode inline styles to a CSS module or shared `styles.promptInput`. | S (30 min) | Ssm2. |
| 5 | Replace hardcoded `#F52776` with `var(--color-accent)` via a CSS module. | XS (5 min) | Ssm3. |
| 6 | Rename `useSubnetPins.ts` → `subnetPins.ts` (not a hook). | XS (5 min) | Ssm4. |
| 7 | Remove the dead `useMemo` fallbacks in SubnetNode. | XS (5 min) | Ssm5. |

**Estimated total to close all findings**: ~3-4h.

## Per-Concept Sanity Check

| Concept | Is it deep? | Would a new dev "get" it from the interface? |
|---|---|---|
| `SubnetPin { handle_id, name, slot_type }` | N/A — data | Yes — three primitives, obvious meaning |
| `useActiveSubGraph(root)` | Yes — resolves nested path + returns path-aware setters | Yes — 3-line signature, usage obvious |
| `resolveLevel(root_nodes, root_edges, path)` | Medium depth | Yes — docblock covers edge cases |
| `updateNodesAtPath(root, path, updater)` | Deep — recursive immutability in 20 LOC | Yes — "structural sharing — does not mutate" in docblock |
| `rootTreeGetter` singleton | Shallow but justified | Yes — docblock explains *why not Zustand* |
| `SubnetEditor` modal | Shallow — delegates to ReactFlowProvider | Yes — renders nothing when path empty |
| `buildInputOnRun / buildOutputOnRun` | Deep — 3-step walk up the tree | Yes — numbered-comment walkthrough in file |

---

**Verdict**: the subnet is the reference implementation of the codebase's
"pure-helpers + dependency-injection + docblocks" pattern. One real
Critical bug (handle_id assignment gap) that's been latent because
nobody tested "create two proxies without renaming". Fix that in 10
minutes and the whole subsystem is production-shippable.
