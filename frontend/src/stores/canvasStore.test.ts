import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore, getProjectCosts, type CostEntry } from './canvasStore'

function makeCost(overrides: Partial<CostEntry> = {}): CostEntry {
  return {
    timestamp: '2026-06-14T00:00:00Z',
    nodeId: 'n1',
    nodeName: 'LLM',
    model: 'gemini',
    inputTokens: 10,
    outputTokens: 20,
    costUsd: 0.01,
    projectId: 'p1',
    ...overrides,
  }
}

describe('canvasStore theme', () => {
  it('defaults to dark', () => {
    expect(useCanvasStore.getState().theme).toBe('dark')
  })

  it('toggleTheme flips dark -> light -> dark', () => {
    useCanvasStore.setState({ theme: 'dark' })
    useCanvasStore.getState().toggleTheme()
    expect(useCanvasStore.getState().theme).toBe('light')
    useCanvasStore.getState().toggleTheme()
    expect(useCanvasStore.getState().theme).toBe('dark')
  })

  it('persists theme to the aycb_ui store', () => {
    useCanvasStore.setState({ theme: 'dark' })
    useCanvasStore.getState().toggleTheme() // -> light
    expect(localStorage.getItem('aycb_ui') ?? '').toContain('"theme":"light"')
  })
})

describe('canvasStore costs — per-project', () => {
  beforeEach(() => {
    useCanvasStore.setState({ costs: [], activeProjectId: null })
  })

  it('stamps projectId from activeProjectId when entry omits it', () => {
    useCanvasStore.setState({ activeProjectId: 'proj-A' })
    // @ts-expect-error — projectId intentionally omitted to test stamping
    useCanvasStore.getState().addCost(makeCost({ projectId: undefined }))
    const costs = useCanvasStore.getState().costs
    expect(costs).toHaveLength(1)
    expect(costs[0].projectId).toBe('proj-A')
  })

  it("stamps 'unknown' when entry and activeProjectId are both absent", () => {
    // @ts-expect-error — projectId intentionally omitted
    useCanvasStore.getState().addCost(makeCost({ projectId: undefined }))
    expect(useCanvasStore.getState().costs[0].projectId).toBe('unknown')
  })

  it('prefers an explicit entry.projectId over activeProjectId', () => {
    useCanvasStore.setState({ activeProjectId: 'proj-A' })
    useCanvasStore.getState().addCost(makeCost({ projectId: 'proj-B' }))
    expect(useCanvasStore.getState().costs[0].projectId).toBe('proj-B')
  })

  it('caps per-project at 500 without touching other projects', () => {
    const add = useCanvasStore.getState().addCost
    // Two entries for the OTHER project (must survive).
    add(makeCost({ projectId: 'other', costUsd: 99 }))
    add(makeCost({ projectId: 'other', costUsd: 99 }))
    // 505 entries for the capped project.
    for (let i = 0; i < 505; i++) add(makeCost({ projectId: 'capme', costUsd: i }))

    const costs = useCanvasStore.getState().costs
    const capped = costs.filter((c) => c.projectId === 'capme')
    const other = costs.filter((c) => c.projectId === 'other')

    expect(capped).toHaveLength(500)
    expect(other).toHaveLength(2)
    // Oldest 5 capped entries (costUsd 0..4) were dropped; newest kept.
    expect(capped[0].costUsd).toBe(5)
    expect(capped[capped.length - 1].costUsd).toBe(504)
  })

  it('removeCostsForProject drops only that project', () => {
    const add = useCanvasStore.getState().addCost
    add(makeCost({ projectId: 'keep' }))
    add(makeCost({ projectId: 'drop' }))
    add(makeCost({ projectId: 'keep' }))

    useCanvasStore.getState().removeCostsForProject('drop')
    const costs = useCanvasStore.getState().costs
    expect(costs).toHaveLength(2)
    expect(costs.every((c) => c.projectId === 'keep')).toBe(true)
  })

  it('getProjectCosts filters to a single project', () => {
    const list = [
      makeCost({ projectId: 'a' }),
      makeCost({ projectId: 'b' }),
      makeCost({ projectId: 'a' }),
    ]
    expect(getProjectCosts(list, 'a')).toHaveLength(2)
    expect(getProjectCosts(list, 'b')).toHaveLength(1)
    expect(getProjectCosts(list, null)).toHaveLength(0)
  })
})
