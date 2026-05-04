import { describe, it, expect, vi } from 'vitest'
import { cloneNodeMedia } from './mediaStore'

function makeMockLoaders(blobs: Record<string, File | null>) {
  const load = vi.fn(async (id: string) => blobs[id] ?? null)
  const save = vi.fn(async () => {})
  return { load, save }
}

describe('cloneNodeMedia', () => {
  it('clones a single mediaId to a new id with the same blob', async () => {
    const file = new File(['hello'], 'a.png', { type: 'image/png' })
    const { load, save } = makeMockLoaders({ 'old-1': file })

    const out = await cloneNodeMedia({ mediaId: 'old-1' }, { load, save })

    expect(out.mediaId).not.toBe('old-1')
    expect(typeof out.mediaId).toBe('string')
    expect(load).toHaveBeenCalledWith('old-1')
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(out.mediaId, file)
  })

  it('clones each id in historyIds preserving order and length', async () => {
    const f1 = new File(['1'], '1.png')
    const f2 = new File(['2'], '2.png')
    const f3 = new File(['3'], '3.png')
    const { load, save } = makeMockLoaders({ 'h-1': f1, 'h-2': f2, 'h-3': f3 })

    const out = await cloneNodeMedia({ historyIds: ['h-1', 'h-2', 'h-3'] }, { load, save })

    const ids = out.historyIds as string[]
    expect(ids).toHaveLength(3)
    expect(ids.every(id => typeof id === 'string')).toBe(true)
    expect(new Set(ids).size).toBe(3)
    expect(ids).not.toContain('h-1')
    expect(ids).not.toContain('h-2')
    expect(ids).not.toContain('h-3')
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('clones each id in frameIds preserving order', async () => {
    const f1 = new File(['a'], 'a.mp4', { type: 'video/mp4' })
    const f2 = new File(['b'], 'b.mp4', { type: 'video/mp4' })
    const { load, save } = makeMockLoaders({ 'f-1': f1, 'f-2': f2 })

    const out = await cloneNodeMedia({ frameIds: ['f-1', 'f-2'] }, { load, save })

    const ids = out.frameIds as string[]
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe('f-1')
    expect(ids[1]).not.toBe('f-2')
  })

  it('clones each value in outputMediaIds preserving keys', async () => {
    const f1 = new File(['a'], 'a.png')
    const f2 = new File(['b'], 'b.png')
    const { load, save } = makeMockLoaders({ 'o-1': f1, 'o-2': f2 })

    const out = await cloneNodeMedia(
      { outputMediaIds: { 'image-out': 'o-1', 'image-out-1': 'o-2' } },
      { load, save },
    )

    const map = out.outputMediaIds as Record<string, string>
    expect(Object.keys(map).sort()).toEqual(['image-out', 'image-out-1'])
    expect(map['image-out']).not.toBe('o-1')
    expect(map['image-out-1']).not.toBe('o-2')
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('dedupes: same id appearing in mediaId and outputMediaIds clones only once', async () => {
    const file = new File(['same'], 'a.png')
    const { load, save } = makeMockLoaders({ 'shared': file })

    const out = await cloneNodeMedia(
      { mediaId: 'shared', outputMediaIds: { 'image-out': 'shared' } },
      { load, save },
    )

    expect(save).toHaveBeenCalledTimes(1)
    const map = out.outputMediaIds as Record<string, string>
    expect(map['image-out']).toBe(out.mediaId)
  })

  it('keeps original id when loadMedia returns null (orphan reference)', async () => {
    const { load, save } = makeMockLoaders({})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const out = await cloneNodeMedia({ mediaId: 'orphan' }, { load, save })

    expect(out.mediaId).toBe('orphan')
    expect(save).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('orphan'))
    warn.mockRestore()
  })

  it('passes through unrelated fields unchanged', async () => {
    const { load, save } = makeMockLoaders({})

    const out = await cloneNodeMedia(
      { prompt: 'hello', selectedModel: 'gemini-3.1-flash-image-preview', aspectRatio: '16:9' },
      { load, save },
    )

    expect(out.prompt).toBe('hello')
    expect(out.selectedModel).toBe('gemini-3.1-flash-image-preview')
    expect(out.aspectRatio).toBe('16:9')
  })

  it('returns a new object without mutating the input', async () => {
    const { load, save } = makeMockLoaders({})
    const input = { mediaId: 'orphan', other: 'x' }

    const out = await cloneNodeMedia(input, { load, save })

    expect(out).not.toBe(input)
    expect(input.mediaId).toBe('orphan')
  })

  it('handles missing media-ref fields gracefully (empty data)', async () => {
    const { load, save } = makeMockLoaders({})

    const out = await cloneNodeMedia({}, { load, save })

    expect(out).toEqual({})
    expect(load).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
