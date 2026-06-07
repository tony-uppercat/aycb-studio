import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import manifest from './node.manifest'
import { useGenerateImageBatch } from './useGenerateImageBatch'

describe('generate-image-batch manifest', () => {
  it('exports a valid manifest', () => {
    expect(manifest.type).toBe('generateImageBatch')
    expect(manifest.category).toBe('media-model')
    expect(manifest.inputs.some(i => i.handleId === 'prompt-in')).toBe(true)
    expect(manifest.outputs.some(o => o.handleId === 'image-out')).toBe(true)
  })

  it('defaults bundleN=5 and bundleT=30', () => {
    expect(manifest.defaultData?.bundleN).toBe(5)
    expect(manifest.defaultData?.bundleT).toBe(30)
  })
})

describe('useGenerateImageBatch — bundle queue', () => {
  beforeEach(() => {
    // shouldAdvanceTime keeps waitFor's polling alive while still letting us
    // call vi.advanceTimersByTime to fast-forward the idle bundleT timer.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    global.fetch = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/batch/submit')) {
        return { ok: true, status: 200, json: async () => ({
          job_id: 'job-1', google_job_name: 'batches/x', state: 'running',
          count: 1, cost_estimate: 0.067,
        }) } as any
      }
      if (typeof url === 'string' && url.includes('/api/batch/jobs')) {
        return { ok: true, status: 200, json: async () => ({ jobs: [] }) } as any
      }
      return { ok: false, status: 404 } as any
    }) as any
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('addToBundle enqueues with snapshot of current settings', () => {
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'cat', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 5, bundleT: 30,
    }, false))
    act(() => { result.current.addToBundle() })
    expect(result.current.pending.length).toBe(1)
    expect(result.current.pending[0].prompt).toBe('cat')
    expect(result.current.pending[0].resolution).toBe('2K')
  })

  it('auto-submits when pending reaches bundleN', async () => {
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'x', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 2, bundleT: 30,
    }, false))
    act(() => { result.current.addToBundle() })
    act(() => { result.current.addToBundle() })
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/batch/submit'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('auto-submits after bundleT seconds idle', async () => {
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'x', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 99, bundleT: 5,
    }, false))
    act(() => { result.current.addToBundle() })
    expect(fetchSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/batch/submit'),
      expect.anything(),
    )
    await act(async () => { vi.advanceTimersByTime(5000) })
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/batch/submit'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('submitNow forces submit regardless of count', async () => {
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'x', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 99, bundleT: 99,
    }, false))
    act(() => { result.current.addToBundle() })
    await act(async () => { await result.current.submitNow() })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/batch/submit'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('hydrates jobs on mount via GET /api/batch/jobs', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/batch/jobs')) {
        return { ok: true, status: 200, json: async () => ({ jobs: [
          { id: 'j1', google_job_name: 'batches/x', node_id: 'node-A',
            model: 'gemini-3-pro-image-preview',
            submitted_at: '2026-05-18T10:00:00Z',
            updated_at: '2026-05-18T10:00:00Z',
            state: 'running', requests: [], results: [], cost_estimate: 0.06, error: null },
        ] }) } as any
      }
      return { ok: false, status: 404 } as any
    }) as any
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: '', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 5, bundleT: 30,
    }, false))
    await waitFor(() => expect(result.current.jobs.length).toBe(1))
    expect(result.current.jobs[0].id).toBe('j1')
  })

  it('cancel calls DELETE and refreshes jobs', async () => {
    const fetchSpy = vi.fn(async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('/api/batch/jobs') && init?.method === 'DELETE') {
        return { ok: true, status: 200, json: async () => ({ state: 'cancelled' }) } as any
      }
      if (typeof url === 'string' && url.includes('/api/batch/jobs')) {
        return { ok: true, status: 200, json: async () => ({ jobs: [
          { id: 'j1', google_job_name: 'batches/x', node_id: 'node-A',
            model: 'gemini-3-pro-image-preview',
            submitted_at: '2026-05-18T10:00:00Z',
            updated_at: '2026-05-18T10:00:00Z',
            state: 'running', requests: [], results: [], cost_estimate: 0.06, error: null },
        ] }) } as any
      }
      return { ok: false, status: 404 } as any
    })
    global.fetch = fetchSpy as any
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: '', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 5, bundleT: 30,
    }, false))
    await waitFor(() => expect(result.current.jobs.length).toBe(1))
    await act(async () => { await result.current.cancelJob('j1') })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/batch/jobs/j1'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('submit error surfaces in error state', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/batch/submit')) {
        return { ok: false, status: 422, text: async () => 'quota exceeded' } as any
      }
      return { ok: true, status: 200, json: async () => ({ jobs: [] }) } as any
    }) as any
    const { result } = renderHook(() => useGenerateImageBatch('node-A', {
      prompt: 'x', selectedModel: 'gemini-3-pro-image-preview',
      aspectRatio: '16:9', resolution: '2K', bundleN: 5, bundleT: 30,
    }, false))
    act(() => { result.current.addToBundle() })
    await act(async () => { await result.current.submitNow() })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.error).toContain('422')
  })
})
