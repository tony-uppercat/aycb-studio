/**
 * Cascade Run — run all upstream nodes in topological order.
 *
 * Nodes register their `onRun` callback here via NodeShell.
 * When cascade is triggered, we walk edges backwards, sort
 * topologically, and execute each registered run in sequence.
 */
import type { Edge } from '@xyflow/react'

// ── Run registry ──────────────────────────────────────────────────────────

const registry = new Map<string, () => Promise<void> | void>()

export function registerNodeRun(nodeId: string, fn: () => Promise<void> | void) {
  registry.set(nodeId, fn)
}

export function unregisterNodeRun(nodeId: string) {
  registry.delete(nodeId)
}

export function hasRegisteredRun(nodeId: string): boolean {
  return registry.has(nodeId)
}

// ── Block registry (frozen nodes) ─────────────────────────────────────────
//
// A blocked node is a frozen boundary. In any chain/cascade/batch/run-selected
// run it does NOT run, and upstream traversal does not walk PAST it to its
// parents — so the node and its ancestors are skipped. Downstream nodes keep
// consuming its already-computed output. A node's own Run button (a direct,
// non-cascade click) still runs it, as a deliberate manual override.
//
// Kept in sync from node.data._blocked by NodeShell.

const blocked = new Set<string>()

export function setNodeBlocked(nodeId: string, isBlocked: boolean) {
  if (isBlocked) blocked.add(nodeId)
  else blocked.delete(nodeId)
}

export function isNodeBlocked(nodeId: string): boolean {
  return blocked.has(nodeId)
}

// ── Topological sort ──────────────────────────────────────────────────────

/**
 * Walk edges backwards from `startId` and return all upstream node IDs
 * in topological order (sources first, target last).
 * Excludes `startId` itself.
 */
export function getUpstreamOrder(startId: string, edges: Edge[]): string[] {
  // BFS backwards to collect all ancestors
  const visited = new Set<string>()
  const queue = [startId]
  while (queue.length) {
    const nid = queue.shift()!
    for (const e of edges) {
      if (e.target === nid && !visited.has(e.source)) {
        // Blocked node = frozen boundary: don't include it, don't walk past it.
        // Its ancestors can still be reached via other, non-blocked paths.
        if (blocked.has(e.source)) continue
        visited.add(e.source)
        queue.push(e.source)
      }
    }
  }

  // Topological sort (Kahn's algorithm) on the subgraph
  const subNodes = [...visited]
  const inDegree = new Map<string, number>(subNodes.map(n => [n, 0]))
  const subEdges = edges.filter(e => visited.has(e.source) && visited.has(e.target))
  for (const e of subEdges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }

  const sorted: string[] = []
  const ready = subNodes.filter(n => (inDegree.get(n) ?? 0) === 0)
  while (ready.length) {
    const n = ready.shift()!
    sorted.push(n)
    for (const e of subEdges) {
      if (e.source !== n) continue
      const deg = (inDegree.get(e.target) ?? 1) - 1
      inDegree.set(e.target, deg)
      if (deg === 0) ready.push(e.target)
    }
  }

  return sorted
}

/**
 * Return upstream node IDs that have a registered `onRun`.
 */
export function getRunnableUpstream(startId: string, edges: Edge[]): string[] {
  return getUpstreamOrder(startId, edges).filter(nid => registry.has(nid))
}

// ── Cascade active node tracking ─────────────────────────────────────────

/** Currently running cascade node IDs (empty when not cascading) */
let _cascadeActiveNodes: Set<string> = new Set()
let _cascadeProgress: { completed: number; total: number } | null = null
const _listeners = new Set<() => void>()

export function getCascadeActiveNodes(): Set<string> { return _cascadeActiveNodes }
export function getCascadeProgress(): { completed: number; total: number } | null { return _cascadeProgress }

// Legacy single-node API for backward compat
export function getCascadeActiveNode(): string | null {
  const first = _cascadeActiveNodes.values().next()
  return first.done ? null : first.value
}

export function subscribeCascade(fn: () => void): () => void {
  _listeners.add(fn)
  return () => { _listeners.delete(fn) }
}

function _notify() { _listeners.forEach(fn => fn()) }

/** Guard: true while a cascade is in progress */
let _cascadeRunning = false

/** Public getter: true while any cascade is executing */
export function isCascadeRunning(): boolean { return _cascadeRunning }

/**
 * True only while a DOWNSTREAM-FEEDING chain run is in progress
 * (executeCascade / executeCascadesParallel) — NOT during runNodesParallel.
 *
 * A node whose output is consumed by a downstream node in the same run must
 * produce its result synchronously; an async (Batch API) submit would resolve
 * minutes/hours later and the downstream node would consume stale/empty input.
 * "Run Selected" (runNodesParallel) has no downstream in-run, so async is safe
 * there and this stays false.
 */
let _chainRunning = false
export function isChainRunning(): boolean { return _chainRunning }

/** Promise that resolves when the current cascade finishes (if any) */
let _cascadeDone: Promise<void> = Promise.resolve()

/**
 * Execute cascade: run all upstream nodes sequentially in topological
 * order (first to last), then the target node.
 * Each node waits for the previous to complete before starting.
 *
 * Only one cascade may run at a time. If a cascade is already running,
 * this call waits for it to finish before starting the new one.
 */
export async function executeCascade(startId: string, edges: Edge[]): Promise<void> {
  // Frozen node: a cascade triggered on it does nothing (use its own Run button).
  if (blocked.has(startId)) return

  // Wait for any in-progress cascade to finish
  if (_cascadeRunning) {
    await _cascadeDone
  }

  _cascadeRunning = true
  _chainRunning = true
  let resolveDone: () => void
  _cascadeDone = new Promise<void>(r => { resolveDone = r })

  try {
    const order = [...getRunnableUpstream(startId, edges), startId]
    const total = order.length

    for (let i = 0; i < order.length; i++) {
      const nid = order[i]
      _cascadeActiveNodes = new Set([nid])
      _cascadeProgress = { completed: i, total }
      _notify()
      const fn = registry.get(nid)
      if (fn) await fn()
    }
  } finally {
    _cascadeActiveNodes = new Set()
    _cascadeProgress = null
    _cascadeRunning = false
    _chainRunning = false
    resolveDone!()
    _notify()
  }
}

/**
 * Execute multiple cascades in parallel.
 * Shared upstream nodes run sequentially first, then all leaf nodes
 * (the startIds themselves) run in parallel via Promise.all.
 *
 * Used by BatchNode to run multiple GenerateImage nodes simultaneously.
 */
export async function executeCascadesParallel(startIds: string[], edges: Edge[]): Promise<void> {
  // Drop frozen leaf nodes — they (and their parents) must not run in a chain.
  const runStarts = startIds.filter(id => !blocked.has(id))
  if (runStarts.length === 0) return
  if (runStarts.length === 1) return executeCascade(runStarts[0], edges)

  // Wait for any in-progress cascade to finish
  if (_cascadeRunning) {
    await _cascadeDone
  }

  _cascadeRunning = true
  _chainRunning = true
  let resolveDone: () => void
  _cascadeDone = new Promise<void>(r => { resolveDone = r })

  try {
    // Phase 1: Run all shared upstream nodes sequentially (deduplicated)
    const ran = new Set<string>()
    const startSet = new Set(runStarts)

    for (const sid of runStarts) {
      const upstream = getRunnableUpstream(sid, edges)
      for (const nid of upstream) {
        if (ran.has(nid) || startSet.has(nid)) continue
        ran.add(nid)
        _cascadeActiveNodes = new Set([nid])
        _cascadeProgress = { completed: ran.size, total: ran.size + runStarts.length }
        _notify()
        const fn = registry.get(nid)
        if (fn) await fn()
      }
    }

    // Phase 2: Run all leaf nodes in PARALLEL
    const upstreamDone = ran.size
    _cascadeActiveNodes = new Set(runStarts)
    _cascadeProgress = { completed: upstreamDone, total: upstreamDone + runStarts.length }
    _notify()

    let completed = 0
    await Promise.all(runStarts.map(async (nid) => {
      const fn = registry.get(nid)
      if (fn) await fn()
      completed++
      _cascadeProgress = { completed: upstreamDone + completed, total: upstreamDone + runStarts.length }
      _notify()
    }))
  } finally {
    _cascadeActiveNodes = new Set()
    _cascadeProgress = null
    _cascadeRunning = false
    _chainRunning = false
    resolveDone!()
    _notify()
  }
}

/**
 * Run ONLY the given nodes' registered run fns, in parallel. No upstream walk,
 * no cascade — each selected node fires with its current inputs. Blocked nodes
 * and nodes without a registered run are skipped.
 *
 * Used by "Run Selected": the user wants exactly the selected nodes to run, not
 * their whole upstream chain.
 */
export async function runNodesParallel(ids: string[]): Promise<void> {
  const runIds = ids.filter(id => !blocked.has(id) && registry.has(id))
  if (runIds.length === 0) return

  // Wait for any in-progress cascade to finish
  if (_cascadeRunning) {
    await _cascadeDone
  }

  _cascadeRunning = true
  let resolveDone: () => void
  _cascadeDone = new Promise<void>(r => { resolveDone = r })

  try {
    _cascadeActiveNodes = new Set(runIds)
    _cascadeProgress = { completed: 0, total: runIds.length }
    _notify()

    let completed = 0
    await Promise.all(runIds.map(async (nid) => {
      const fn = registry.get(nid)
      if (fn) await fn()
      completed++
      _cascadeProgress = { completed, total: runIds.length }
      _notify()
    }))
  } finally {
    _cascadeActiveNodes = new Set()
    _cascadeProgress = null
    _cascadeRunning = false
    resolveDone!()
    _notify()
  }
}
