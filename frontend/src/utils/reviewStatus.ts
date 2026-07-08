import { STORAGE_KEYS } from '../storage/keys'

export interface ReviewStatus {
  status: 'approved' | 'rejected' | 'pending' | null
  reviewed_by: string | null
  reviewed_at: string | null
  comments_count: number
  drawings_count: number
  favorite: boolean
}

// ── Client-side metadata cache ───────────────────────────────────────────────
// Stores generation metadata in localStorage so it's available without backend
// (e.g., Vercel cloud mode). Capped at 500 entries.
const META_KEY = STORAGE_KEYS.MEDIA_META
const MAX_META = 500

export function saveMediaMeta(mediaId: string, meta: Record<string, unknown>) {
  try {
    const map = JSON.parse(localStorage.getItem(META_KEY) ?? '{}')
    map[mediaId] = meta
    const keys = Object.keys(map)
    if (keys.length > MAX_META) {
      for (let i = 0; i < keys.length - MAX_META; i++) delete map[keys[i]]
    }
    localStorage.setItem(META_KEY, JSON.stringify(map))
  } catch { /* quota */ }
}

export function getMediaMeta(mediaId: string): Record<string, unknown> | null {
  try {
    const map = JSON.parse(localStorage.getItem(META_KEY) ?? '{}')
    return map[mediaId] ?? null
  } catch { return null }
}

// ── mediaId → bridge stem mapping ────────────────────────────────────────────
// Persisted to localStorage so it survives page reload. Capped at MAX_STEMS
// entries — was unbounded and grew forever (3675 entries observed 2026-05-19).
const STEM_MAP_KEY = STORAGE_KEYS.BRIDGE_STEMS
export const MAX_STEMS = 2000

/** Drop oldest entries when over cap (mediaIds embed Date.now → sortable). */
export function pruneStemMap(
  map: Record<string, string>,
  max: number = MAX_STEMS,
): Record<string, string> {
  const keys = Object.keys(map)
  if (keys.length <= max) return map
  const pruned: Record<string, string> = {}
  for (const k of keys.sort().slice(keys.length - max)) pruned[k] = map[k]
  return pruned
}

function _loadStemMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STEM_MAP_KEY) ?? '{}')
  } catch { return {} }
}

function _saveStemMap(map: Record<string, string>) {
  try {
    localStorage.setItem(STEM_MAP_KEY, JSON.stringify(pruneStemMap(map)))
  } catch (e) {
    console.warn('[reviewStatus] failed to persist stem map:', e)
  }
}

/** Register a mapping from an IndexedDB mediaId to its bridge stem (e.g. "generated_1774517737168"). */
export function registerBridgeStem(mediaId: string, stem: string) {
  const map = _loadStemMap()
  map[mediaId] = stem
  _saveStemMap(map)
}

/** Return the bridge stem for a mediaId, or null if unknown. */
export function getStemForMedia(mediaId: string): string | null {
  return _loadStemMap()[mediaId] ?? null
}

export const MAX_REVIEW_CACHE = 500

const cache = new Map<string, ReviewStatus | null>()

function cacheSet(key: string, value: ReviewStatus | null) {
  if (cache.size >= MAX_REVIEW_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

// Circuit breaker: stop all requests when backend is down
let circuitOpen = false
let circuitOpenUntil = 0
const CIRCUIT_COOLDOWN_MS = 30_000 // 30s backoff when backend is unreachable
let consecutiveFailures = 0
const MAX_FAILURES_BEFORE_OPEN = 3

// Concurrency limiter: max 2 in-flight requests at a time
let inFlight = 0
const MAX_IN_FLIGHT = 2
const pending: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++
    return Promise.resolve()
  }
  return new Promise(resolve => pending.push(resolve))
}

function releaseSlot() {
  inFlight--
  const next = pending.shift()
  if (next) { inFlight++; next() }
}

export async function fetchReviewStatus(mediaId: string): Promise<ReviewStatus | null> {
  if (cache.has(mediaId)) return cache.get(mediaId) ?? null

  // Circuit breaker: skip if backend was recently unreachable
  if (circuitOpen) {
    if (Date.now() < circuitOpenUntil) return null
    circuitOpen = false // try again after cooldown
  }

  // Resolve IndexedDB mediaIds (e.g. "media-1774517737168-gro5ve") to bridge stems
  // (e.g. "generated_1774517737168") so the backend can find the .review.json sidecar.
  const lookupId = getStemForMedia(mediaId) ?? mediaId

  await acquireSlot()
  try {
    const r = await fetch(`/api/bridge/review/${encodeURIComponent(lookupId)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) {
      cacheSet(mediaId, null)
      if (r.status === 502 || r.status === 503) {
        consecutiveFailures++
        if (consecutiveFailures >= MAX_FAILURES_BEFORE_OPEN) {
          circuitOpen = true
          circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS
        }
      }
      return null
    }
    consecutiveFailures = 0
    const data = await r.json()
    if (data.status === 'not_reviewed') {
      cacheSet(mediaId, null)
      return null
    }
    const result: ReviewStatus = {
      status: data.status,
      reviewed_by: data.reviewed_by ?? null,
      reviewed_at: data.reviewed_at ?? null,
      comments_count: data.comments?.length ?? 0,
      drawings_count: data.drawings_count ?? 0,
      favorite: data.favorite === true,
    }
    cacheSet(mediaId, result)
    return result
  } catch {
    cacheSet(mediaId, null)
    consecutiveFailures++
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_OPEN) {
      circuitOpen = true
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS
    }
    return null
  } finally {
    releaseSlot()
  }
}

export function clearReviewCache() {
  cache.clear()
  circuitOpen = false
  consecutiveFailures = 0
}

/** Toggle favorite/approved/rejected status via AYCB backend proxy to Review Hub. */
export async function toggleFavorite(
  mediaId: string,
  status: 'favorite' | 'approved' | 'rejected' = 'favorite',
): Promise<boolean> {
  const stem = getStemForMedia(mediaId) ?? mediaId
  try {
    const r = await fetch('/api/bridge/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stem, status }),
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return false
    // Invalidate cache so next fetch gets fresh data
    cache.delete(mediaId)
    return true
  } catch {
    return false
  }
}
