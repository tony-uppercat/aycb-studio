import { useCanvasStore } from './stores/canvasStore'

// legacy DB name, do not rename (would lose user data)
const DB_NAME = 'geminishot_media'
const STORE_NAME = 'blobs'
const THUMBS_STORE = 'thumbs'
const DB_VERSION = 2
const MAX_MEDIA_ITEMS = 1000

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
      if (!db.objectStoreNames.contains(THUMBS_STORE)) {
        db.createObjectStore(THUMBS_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveMedia(id: string, file: File): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ blob: file, name: file.name, type: file.type }, id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadMedia(id: string): Promise<File | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => {
      const val = req.result
      db.close()
      if (!val) { resolve(null); return }
      const file = new File([val.blob], val.name, { type: val.type })
      resolve(file)
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export function generateMediaId(): string {
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export interface MediaEntry {
  id: string
  name: string
  type: string
  size: number
}

export async function deleteMedia(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(id)
    req.onsuccess = () => { db.close(); resolve() }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function deleteMultipleMedia(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    for (const id of ids) store.delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// ── Storage Estimate ─────────────────────────────────────────────────────────

export interface StorageEstimate {
  usageBytes: number
  quotaBytes: number
  usageMB: number
  quotaMB: number
  percentUsed: number
}

export async function getStorageEstimate(): Promise<StorageEstimate> {
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate()
      const usage = est.usage ?? 0
      const quota = est.quota ?? 0
      return {
        usageBytes: usage,
        quotaBytes: quota,
        usageMB: Math.round(usage / 1024 / 1024),
        quotaMB: Math.round(quota / 1024 / 1024),
        percentUsed: quota > 0 ? Math.round((usage / quota) * 100) : 0,
      }
    }
  } catch { /* fallback */ }
  return { usageBytes: 0, quotaBytes: 0, usageMB: 0, quotaMB: 0, percentUsed: 0 }
}

// ── List Media IDs (lightweight, no blob loading) ────────────────────────────

export async function listMediaIds(): Promise<string[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAllKeys()
    req.onsuccess = () => { db.close(); resolve(req.result as string[]) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

// ── Project-aware save ───────────────────────────────────────────────────────

/**
 * Save media blob to IndexedDB AND register it in the active project's mediaIds.
 * Use this everywhere a user action creates new media (upload, generate, effects, etc.).
 * Falls back to raw saveMedia if no active project is set.
 */
export async function saveMediaForProject(id: string, file: File): Promise<void> {
  await saveMedia(id, file)
  const projectId = useCanvasStore.getState().activeProjectId
  if (projectId) {
    try {
      const { addMediaToProject } = await import('./stores/projectStore')
      await addMediaToProject(projectId, id)
    } catch (e) {
      console.warn('[mediaStore] Failed to register media in project:', e)
    }
  }
  // Fire-and-forget: evict oldest blobs if over cap
  enforceStorageCap().catch(() => { /* storage quota exceeded, non-fatal */ })
}

// ── Orphan Sweep ─────────────────────────────────────────────────────────────

/**
 * Delete IndexedDB media blobs that are no longer referenced by any project.
 * Safe to call on project switch or app startup — not on every node delete.
 */
export async function orphanSweep(): Promise<void> {
  try {
    const [allIds, projects] = await Promise.all([
      listMediaIds(),
      (await import('./stores/projectStore')).listProjects(),
    ])
    const referenced = new Set<string>()
    for (const project of projects) {
      for (const id of project.mediaIds) referenced.add(id)
      for (const node of project.canvas?.nodes || []) {
        const d = node.data as Record<string, unknown>
        if (typeof d.mediaId === 'string') referenced.add(d.mediaId)
        if (Array.isArray(d.historyIds))
          for (const h of d.historyIds) if (typeof h === 'string') referenced.add(h)
        if (Array.isArray(d.frameIds))
          for (const f of d.frameIds) if (typeof f === 'string') referenced.add(f)
      }
    }
    const orphans = allIds.filter(id => !referenced.has(id))
    if (orphans.length > 0) {
      await deleteMultipleMedia(orphans)
      console.log(`[mediaStore] orphanSweep: removed ${orphans.length} orphan blob(s)`)
    }
  } catch (e) {
    console.warn('[mediaStore] orphanSweep failed:', e)
  }
}

// ── Storage Cap ─────────────────────────────────────────────────────────────

/**
 * Evict oldest media blobs when total count exceeds MAX_MEDIA_ITEMS.
 * IDs contain timestamps (media-{Date.now()}-xxx), so sorting ascending
 * gives oldest-first order.
 */
export async function enforceStorageCap(): Promise<void> {
  try {
    const ids = await listMediaIds()
    if (ids.length <= MAX_MEDIA_ITEMS) return
    const sorted = ids.sort()
    const toDelete = sorted.slice(0, ids.length - MAX_MEDIA_ITEMS)
    await deleteMultipleMedia(toDelete)
    console.log(`[mediaStore] enforceStorageCap: evicted ${toDelete.length} oldest blob(s)`)
  } catch (e) {
    console.warn('[mediaStore] enforceStorageCap failed:', e)
  }
}

// ── Thumbnail Cache ──────────────────────────────────────────────────────────

export async function saveThumbnail(id: string, blob: Blob): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBS_STORE, 'readwrite')
    tx.objectStore(THUMBS_STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getThumbnail(id: string): Promise<Blob | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(THUMBS_STORE, 'readonly')
    const req = tx.objectStore(THUMBS_STORE).get(id)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function generateThumbnail(file: File, maxPx = 200): Promise<Blob> {
  if (file.type.startsWith('video/')) {
    // For video, return a placeholder empty blob — videos show no thumbnail
    return new Blob([], { type: 'image/jpeg' })
  }
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(maxPx / bitmap.width, maxPx / bitmap.height, 1)
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
}

export async function loadAllThumbnails(ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (const id of ids) {
    const blob = await getThumbnail(id)
    if (blob && blob.size > 0) {
      result.set(id, URL.createObjectURL(blob))
    }
  }
  return result
}

// ── List Media (full metadata) ───────────────────────────────────────────────

export async function listMedia(): Promise<MediaEntry[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.openCursor()
    const entries: MediaEntry[] = []
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        const val = cursor.value
        const blob: Blob = val.blob
        entries.push({
          id: cursor.key as string,
          name: val.name ?? 'unknown',
          type: val.type ?? 'application/octet-stream',
          size: blob?.size ?? 0,
        })
        cursor.continue()
      } else {
        db.close()
        resolve(entries)
      }
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}
