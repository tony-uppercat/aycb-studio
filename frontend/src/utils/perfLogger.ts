/**
 * Browser performance & error logger.
 *
 * Captures unhandled errors, promise rejections, long tasks, LCP, CLS.
 * Batches events and flushes to POST /api/perf every 10s.
 *
 * Guards:
 * - Self-exclusion: errors from flush itself are ignored
 * - Dedup: same message within 10s = skip
 * - Batch cap: max 50 events per flush
 */

interface PerfEvent {
  type: string
  message?: string
  timestamp: string
  value?: number
  extra?: Record<string, unknown>
}

const FLUSH_INTERVAL = 10_000
const DEDUP_WINDOW = 10_000
const MAX_BATCH = 50

let queue: PerfEvent[] = []
let recentMessages = new Map<string, number>()
let flushing = false

function now(): string {
  return new Date().toISOString()
}

function isDuplicate(msg: string): boolean {
  const prev = recentMessages.get(msg)
  const t = Date.now()
  if (prev && t - prev < DEDUP_WINDOW) return true
  recentMessages.set(msg, t)
  // Prune old entries
  if (recentMessages.size > 100) {
    for (const [k, v] of recentMessages) {
      if (t - v > DEDUP_WINDOW) recentMessages.delete(k)
    }
  }
  return false
}

function push(ev: PerfEvent) {
  if (queue.length < MAX_BATCH) queue.push(ev)
}

async function flush() {
  if (flushing || queue.length === 0) return
  const batch = queue.splice(0, MAX_BATCH)
  flushing = true
  try {
    await fetch('/api/perf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    })
  } catch {
    // Backend down — discard, don't re-queue (avoid buildup)
  }
  flushing = false
}

// ── Collectors ──────────────────────────────────────────────────────────────

function captureErrors() {
  window.addEventListener('error', (e) => {
    // Skip errors from our own flush
    if (e.filename?.includes('perfLogger')) return
    const msg = e.message || 'Unknown error'
    if (isDuplicate(msg)) return
    push({
      type: 'error',
      message: msg,
      timestamp: now(),
      extra: {
        source: e.filename,
        line: e.lineno,
        col: e.colno,
      },
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason?.message || e.reason?.toString?.() || 'Unhandled rejection'
    if (msg.includes('/api/perf')) return // self-exclusion
    if (isDuplicate(msg)) return
    push({
      type: 'rejection',
      message: msg,
      timestamp: now(),
    })
  })
}

function captureLongTasks() {
  if (!('PerformanceObserver' in window)) return
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < 100) continue // only log >100ms tasks
        push({
          type: 'long-task',
          timestamp: now(),
          value: Math.round(entry.duration),
        })
      }
    })
    obs.observe({ type: 'longtask', buffered: true })
  } catch {
    // longtask not supported in this browser
  }
}

function captureWebVitals() {
  if (!('PerformanceObserver' in window)) return

  // LCP
  try {
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      if (last) {
        push({
          type: 'lcp',
          timestamp: now(),
          value: Math.round(last.startTime),
        })
      }
    })
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true })
  } catch { /* not supported */ }

  // CLS
  try {
    let clsValue = 0
    const clsObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) {
          clsValue += (entry as PerformanceEntry & { value: number }).value
        }
      }
    })
    clsObs.observe({ type: 'layout-shift', buffered: true })
    // Report CLS on page hide
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && clsValue > 0) {
        push({ type: 'cls', timestamp: now(), value: parseFloat(clsValue.toFixed(4)) })
        flush()
      }
    })
  } catch { /* not supported */ }
}

// ── Public emit (instrumentation outside the default collectors) ────────────

/** Emit a custom perf event from anywhere in the app. Dedup skipped — caller
 *  decides cadence. Honors MAX_BATCH the same way as automatic events. */
export function logPerfEvent(type: string, value?: number, extra?: Record<string, unknown>): void {
  push({ type, timestamp: now(), ...(value !== undefined ? { value } : {}), ...(extra ? { extra } : {}) })
}

// ── Init ────────────────────────────────────────────────────────────────────

let initialized = false

export function initPerfLogger() {
  if (initialized) return
  initialized = true

  captureErrors()
  captureLongTasks()
  captureWebVitals()

  setInterval(flush, FLUSH_INTERVAL)
  // Flush on page unload
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
