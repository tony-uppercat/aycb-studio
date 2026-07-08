import { describe, it, expect } from 'vitest'
import { collectReferencedIds, selectCapEvictions } from './storageCap'

function proj(mediaIds: string[], nodes: Array<Record<string, unknown>> = []) {
  return {
    mediaIds,
    canvas: { nodes: nodes.map(data => ({ data })) },
  }
}

describe('collectReferencedIds', () => {
  it('collects mediaIds from all projects', () => {
    const refs = collectReferencedIds([proj(['a', 'b']), proj(['c'])])
    expect(refs).toEqual(new Set(['a', 'b', 'c']))
  })

  it('collects mediaId, historyIds and frameIds from canvas nodes', () => {
    const refs = collectReferencedIds([
      proj([], [
        { mediaId: 'm1' },
        { historyIds: ['h1', 'h2', 42] },
        { frameIds: ['f1', null] },
      ]),
    ])
    expect(refs).toEqual(new Set(['m1', 'h1', 'h2', 'f1']))
  })

  it('tolerates projects without canvas', () => {
    const refs = collectReferencedIds([{ mediaIds: ['a'], canvas: undefined }])
    expect(refs).toEqual(new Set(['a']))
  })
})

describe('selectCapEvictions', () => {
  const ids = (n: number, prefix = 'media-') =>
    Array.from({ length: n }, (_, i) => `${prefix}${String(1000 + i)}`)

  it('returns empty when under cap', () => {
    expect(selectCapEvictions(ids(5), new Set(), 10)).toEqual([])
  })

  it('evicts only orphans, oldest first', () => {
    const all = ids(6) // media-1000 … media-1005
    const referenced = new Set(['media-1000', 'media-1001'])
    // cap 3 → excess 3, but the two oldest are referenced → evict oldest orphans
    expect(selectCapEvictions(all, referenced, 3)).toEqual([
      'media-1002', 'media-1003', 'media-1004',
    ])
  })

  it('NEVER evicts referenced media even when still over cap', () => {
    const all = ids(6)
    const referenced = new Set(all.slice(0, 5)) // only media-1005 is orphan
    const evicted = selectCapEvictions(all, referenced, 3)
    expect(evicted).toEqual(['media-1005'])
    for (const id of evicted) expect(referenced.has(id)).toBe(false)
  })

  it('evicts nothing when everything is referenced', () => {
    const all = ids(6)
    expect(selectCapEvictions(all, new Set(all), 3)).toEqual([])
  })
})
