/**
 * Tests for useModelRegistry — the C3 front-end hook that replaces
 * hardcoded VIDEO_MODELS / IMAGE_MODELS / MODEL_MAP arrays.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useModelRegistry, fetchRegistry, _resetRegistryCache, type RegistryModel } from './useModelRegistry'

const SAMPLE: RegistryModel[] = [
  {
    id: 'vertex-veo-3.1',
    name: 'Veo 3.1',
    provider: 'vertex',
    capability: 'video',
    cost_per_call: null,
    cost_per_token: null,
    cost_per_sec: { '720p': 0.4 },
    aspect_ratios: ['16:9', '9:16'],
    allowed_durations: [4, 6, 8],
    default_duration: 8,
    qualities: ['720p', '1080p'],
    max_ref_images: 3,
    deprecated: false,
    endpoint_t2v: null,
    endpoint_i2v: null,
    provider_model_id: 'veo-3.1-generate-preview',
    task_type: null,
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Nano Banana 2',
    provider: 'gemini',
    capability: 'image',
    cost_per_call: 0.067,
    cost_per_token: null,
    cost_per_sec: null,
    aspect_ratios: ['1:1', '16:9'],
    allowed_durations: [],
    default_duration: 5,
    qualities: ['1K', '2K'],
    max_ref_images: 0,
    deprecated: false,
    endpoint_t2v: null,
    endpoint_i2v: null,
    provider_model_id: null,
    task_type: null,
  },
]


beforeEach(() => {
  _resetRegistryCache()
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ models: SAMPLE }),
  } as unknown as Response)))
})


describe('fetchRegistry', () => {
  it('returns the full model list on first call', async () => {
    const result = await fetchRegistry()
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('vertex-veo-3.1')
  })

  it('caches subsequent calls without re-fetching', async () => {
    await fetchRegistry()
    await fetchRegistry()
    await fetchRegistry()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('shares in-flight promises between concurrent callers', async () => {
    const [a, b, c] = await Promise.all([
      fetchRegistry(), fetchRegistry(), fetchRegistry(),
    ])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})


describe('useModelRegistry', () => {
  it('returns [] before the fetch resolves', () => {
    const { result } = renderHook(() => useModelRegistry())
    expect(result.current).toEqual([])
  })

  it('populates with all models when no capability filter passed', async () => {
    const { result } = renderHook(() => useModelRegistry())
    await waitFor(() => {
      expect(result.current).toHaveLength(2)
    })
  })

  it('filters by capability', async () => {
    const { result } = renderHook(() => useModelRegistry('video'))
    await waitFor(() => {
      expect(result.current).toHaveLength(1)
      expect(result.current[0].capability).toBe('video')
    })
  })

  it('filter=image returns only image-capability models', async () => {
    const { result } = renderHook(() => useModelRegistry('image'))
    await waitFor(() => {
      expect(result.current).toHaveLength(1)
      expect(result.current[0].id).toBe('gemini-3.1-flash-image-preview')
    })
  })
})
