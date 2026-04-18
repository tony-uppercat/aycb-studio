/**
 * useModelRegistry — single-source-of-truth access to backend model data.
 *
 * The backend's src/registry.py exposes every model (text/image/edit/video)
 * through /api/registry/models; this hook caches the first successful
 * fetch at module scope so the dozen-ish consumers that call it (one per
 * model dropdown) share a single HTTP round trip.
 *
 * Part of C3 migration: frontend VIDEO_MODELS / IMAGE_MODELS / MODEL_MAP
 * / BFL_MODELS dicts are being phased out in favor of the registry. Until
 * every consumer has migrated the local dicts remain; a drift test in
 * test_registry.py guards against divergence in the meantime.
 */
import { useEffect, useState } from 'react'

export type Capability = 'text' | 'image' | 'edit' | 'video'

export interface RegistryModel {
  id: string
  name: string
  provider: string
  capability: Capability
  cost_per_call: number | null
  cost_per_token: [number, number] | null
  cost_per_sec: Record<string, number> | null
  aspect_ratios: string[]
  allowed_durations: number[]
  default_duration: number
  qualities: string[]
  max_ref_images: number
  deprecated: boolean
  tooltip: string | null
  endpoint_t2v: string | null
  endpoint_i2v: string | null
  provider_model_id: string | null
  task_type: string | null
}

let _cache: RegistryModel[] | null = null
let _inflight: Promise<RegistryModel[]> | null = null

/** Fetch the registry once per page load and cache it. */
export async function fetchRegistry(): Promise<RegistryModel[]> {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = fetch('/api/registry/models')
    .then(async (r) => {
      if (!r.ok) throw new Error(`registry fetch failed: ${r.status}`)
      const data = await r.json()
      _cache = data.models as RegistryModel[]
      return _cache
    })
    .finally(() => { _inflight = null })
  return _inflight
}

/** Reset the module-scope cache. Exported for tests. */
export function _resetRegistryCache() {
  _cache = null
  _inflight = null
}

/**
 * Return the cached registry synchronously, or null if no fetch has
 * resolved yet. For call sites that can't reasonably block on a hook
 * (e.g. provider cost calculations inside async generation flows, where
 * React context is not available). The first render of any node that
 * calls useModelRegistry warms the cache; by the time a user clicks
 * Run, the cache is populated. If the cache is cold, fall back to
 * provider-local hardcoded values.
 */
export function getCachedRegistry(): RegistryModel[] | null {
  return _cache
}

/**
 * React hook returning the registry (filtered by capability if provided).
 * Returns an empty array until the first fetch resolves; components that
 * need a guaranteed non-empty list should render a skeleton / fallback.
 */
export function useModelRegistry(capability?: Capability): RegistryModel[] {
  const [models, setModels] = useState<RegistryModel[]>(
    () => {
      if (!_cache) return []
      return capability ? _cache.filter((m) => m.capability === capability) : _cache
    },
  )

  useEffect(() => {
    let cancelled = false
    fetchRegistry().then((all) => {
      if (cancelled) return
      setModels(capability ? all.filter((m) => m.capability === capability) : all)
    }).catch((err) => {
      if (!cancelled) console.warn('[useModelRegistry] fetch failed:', err)
    })
    return () => { cancelled = true }
  }, [capability])

  return models
}
