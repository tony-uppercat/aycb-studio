import { describe, it, expect, afterEach, vi } from 'vitest'
import type { Edge } from '@xyflow/react'
import {
  registerNodeRun,
  unregisterNodeRun,
  getUpstreamOrder,
  executeCascade,
  executeCascadesParallel,
  runNodesParallel,
  setNodeBlocked,
  isNodeBlocked,
  isChainRunning,
} from './cascadeRun'

const edge = (s: string, t: string): Edge =>
  ({ id: `${s}-${t}`, source: s, target: t, sourceHandle: 'out', targetHandle: 'in' })

afterEach(() => {
  ;['a', 'b', 'c', 'd'].forEach(id => { unregisterNodeRun(id); setNodeBlocked(id, false) })
})

describe('cascadeRun blocking — traversal', () => {
  const chain = [edge('a', 'b'), edge('b', 'c')]

  it('without blocking, upstream of c is [a, b]', () => {
    expect(getUpstreamOrder('c', chain)).toEqual(['a', 'b'])
  })

  it('a blocked middle node removes it AND its parents from upstream', () => {
    setNodeBlocked('b', true)
    expect(isNodeBlocked('b')).toBe(true)
    expect(getUpstreamOrder('c', chain)).toEqual([]) // b is a frozen boundary; a unreachable past it
  })

  it('a shared parent still runs via a non-blocked branch', () => {
    // a → b → d  and  a → c → d ; block b
    const g = [edge('a', 'b'), edge('b', 'd'), edge('a', 'c'), edge('c', 'd')]
    setNodeBlocked('b', true)
    const up = getUpstreamOrder('d', g)
    expect(up).toContain('a') // reachable via the c branch
    expect(up).toContain('c')
    expect(up).not.toContain('b')
  })
})

describe('cascadeRun blocking — execution', () => {
  const chain = [edge('a', 'b'), edge('b', 'c')]

  it('cascade skips a blocked node and its parents', async () => {
    const order: string[] = []
    registerNodeRun('a', () => { order.push('a') })
    registerNodeRun('b', () => { order.push('b') })
    registerNodeRun('c', () => { order.push('c') })
    setNodeBlocked('b', true)
    await executeCascade('c', chain)
    expect(order).toEqual(['c']) // a and b skipped
  })

  it('a cascade triggered on a blocked node does nothing', async () => {
    const fn = vi.fn()
    registerNodeRun('b', fn)
    setNodeBlocked('b', true)
    await executeCascade('b', chain)
    expect(fn).not.toHaveBeenCalled()
  })

  it('run-selected drops a blocked leaf (and its parents), keeps the rest', async () => {
    const fnA = vi.fn(), fnB = vi.fn(), fnC = vi.fn()
    registerNodeRun('a', fnA); registerNodeRun('b', fnB); registerNodeRun('c', fnC)
    // a → b  and  a → c ; block b, run [b, c]
    const g = [edge('a', 'b'), edge('a', 'c')]
    setNodeBlocked('b', true)
    await executeCascadesParallel(['b', 'c'], g)
    expect(fnB).not.toHaveBeenCalled()
    expect(fnC).toHaveBeenCalledTimes(1)
    expect(fnA).toHaveBeenCalledTimes(1) // shared upstream still runs for the c branch
  })
})

describe('isChainRunning — true only inside a downstream-feeding chain run', () => {
  const chain = [edge('a', 'b'), edge('b', 'c')]

  it('is false at rest', () => {
    expect(isChainRunning()).toBe(false)
  })

  it('is TRUE while an executeCascade node is running (downstream consumes its output)', async () => {
    let seen: boolean | null = null
    registerNodeRun('a', () => { seen = isChainRunning() })
    await executeCascade('a', chain)
    expect(seen).toBe(true)
    expect(isChainRunning()).toBe(false) // reset after
  })

  it('is TRUE while executeCascadesParallel runs', async () => {
    let seen: boolean | null = null
    const g = [edge('a', 'b'), edge('a', 'c')]
    registerNodeRun('b', () => { seen = isChainRunning() })
    registerNodeRun('c', () => {})
    await executeCascadesParallel(['b', 'c'], g)
    expect(seen).toBe(true)
  })

  it('is FALSE during runNodesParallel (Run Selected has no downstream to feed → async is safe)', async () => {
    let seen: boolean | null = null
    registerNodeRun('c', () => { seen = isChainRunning() })
    await runNodesParallel(['c'])
    expect(seen).toBe(false)
    expect(isChainRunning()).toBe(false)
  })
})

describe('runNodesParallel — only the selected run, no upstream', () => {
  it('runs only the given nodes, never their upstream', async () => {
    const fnA = vi.fn(), fnB = vi.fn(), fnC = vi.fn()
    registerNodeRun('a', fnA); registerNodeRun('b', fnB); registerNodeRun('c', fnC)
    await runNodesParallel(['c'])
    expect(fnC).toHaveBeenCalledTimes(1)
    expect(fnA).not.toHaveBeenCalled() // upstream NOT run
    expect(fnB).not.toHaveBeenCalled()
  })

  it('runs multiple selected nodes in parallel, skipping blocked ones', async () => {
    const fnA = vi.fn(), fnB = vi.fn(), fnC = vi.fn()
    registerNodeRun('a', fnA); registerNodeRun('b', fnB); registerNodeRun('c', fnC)
    setNodeBlocked('b', true)
    await runNodesParallel(['a', 'b', 'c'])
    expect(fnA).toHaveBeenCalledTimes(1)
    expect(fnC).toHaveBeenCalledTimes(1)
    expect(fnB).not.toHaveBeenCalled() // blocked
  })
})
