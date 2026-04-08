/**
 * Project Store — IndexedDB-based multi-project persistence.
 *
 * DB: geminishot_projects (v1) — IndexedDB name intentionally kept (renaming IDB is complex/risky)
 * Stores:
 *   - projects (keyPath: id) — full project records
 *   - meta (keyPath: key) — singleton config (activeProjectId)
 */

import type { Node, Edge, Viewport } from '@xyflow/react'
import { STORAGE_KEYS } from '../storage/keys'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProjectRecord {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  thumbnailB64?: string
  canvas: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
  settings: {
    model: string
    doEmbed: boolean
  }
  mediaIds: string[]
}

interface MetaRecord {
  key: string
  value: string
}

// ── Constants ────────────────────────────────────────────────────────────────

// legacy DB name, do not rename (would lose user data)
const DB_NAME = 'geminishot_projects'
const DB_VERSION = 1
const STORE_PROJECTS = 'projects'
const STORE_META = 'meta'
const ACTIVE_PROJECT_KEY = STORAGE_KEYS.ACTIVE_PROJECT_ID

// ── DB Connection ────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── ID Generation ────────────────────────────────────────────────────────────

export function generateProjectId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `proj-${Date.now()}-${rand}`
}

// ── CRUD Operations ──────────────────────────────────────────────────────────

export async function createProject(
  name: string,
  canvas?: ProjectRecord['canvas'],
  settings?: ProjectRecord['settings'],
): Promise<ProjectRecord> {
  const now = new Date().toISOString()
  const record: ProjectRecord = {
    id: generateProjectId(),
    name,
    createdAt: now,
    updatedAt: now,
    canvas: canvas ?? { nodes: [], edges: [] },
    settings: settings ?? { model: 'Gemini 3 Flash', doEmbed: false },
    mediaIds: [],
  }
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite')
    tx.objectStore(STORE_PROJECTS).put(record)
    tx.oncomplete = () => { db.close(); resolve(record) }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly')
    const req = tx.objectStore(STORE_PROJECTS).get(id)
    req.onsuccess = () => { db.close(); resolve(req.result ?? null) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<ProjectRecord, 'id' | 'createdAt'>>,
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite')
    const store = tx.objectStore(STORE_PROJECTS)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const existing = getReq.result as ProjectRecord | undefined
      if (!existing) {
        db.close()
        reject(new Error(`Project ${id} not found`))
        return
      }
      const updated: ProjectRecord = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      }
      store.put(updated)
    }
    getReq.onerror = () => { db.close(); reject(getReq.error) }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readwrite')
    tx.objectStore(STORE_PROJECTS).delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, 'readonly')
    const req = tx.objectStore(STORE_PROJECTS).getAll()
    req.onsuccess = () => {
      db.close()
      const projects = req.result as ProjectRecord[]
      // Sort by updatedAt descending (most recent first)
      projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      resolve(projects)
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

// ── Active Project ───────────────────────────────────────────────────────────

export async function getActiveProjectId(): Promise<string | null> {
  // Fast path: check localStorage first (avoids async IDB on every page load)
  const cached = localStorage.getItem(ACTIVE_PROJECT_KEY)
  if (cached) return cached

  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly')
    const req = tx.objectStore(STORE_META).get(ACTIVE_PROJECT_KEY)
    req.onsuccess = () => {
      db.close()
      const meta = req.result as MetaRecord | undefined
      resolve(meta?.value ?? null)
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function setActiveProjectId(id: string): Promise<void> {
  // Cache in localStorage for fast sync access on next load
  localStorage.setItem(ACTIVE_PROJECT_KEY, id)

  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite')
    tx.objectStore(STORE_META).put({ key: ACTIVE_PROJECT_KEY, value: id } as MetaRecord)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// ── Project Media Tracking ───────────────────────────────────────────────────

export async function addMediaToProject(projectId: string, mediaId: string): Promise<void> {
  const project = await getProject(projectId)
  if (!project) return
  if (project.mediaIds.includes(mediaId)) return
  await updateProject(projectId, { mediaIds: [...project.mediaIds, mediaId] })
}

export async function removeMediaFromProject(projectId: string, mediaId: string): Promise<void> {
  const project = await getProject(projectId)
  if (!project) return
  await updateProject(projectId, {
    mediaIds: project.mediaIds.filter(id => id !== mediaId),
  })
}

// ── Migration from localStorage ──────────────────────────────────────────────

const LS_CANVAS_KEY = STORAGE_KEYS.CANVAS
const LS_SETTINGS_KEY = STORAGE_KEYS.SETTINGS

export async function migrateFromLocalStorage(): Promise<string | null> {
  const canvasJson = localStorage.getItem(LS_CANVAS_KEY)
  if (!canvasJson) return null

  try {
    const parsed = JSON.parse(canvasJson)
    const nodes = parsed.nodes ?? []
    const edges = parsed.edges ?? []
    const viewport = parsed.viewport

    // Collect mediaIds from nodes
    const mediaIds: string[] = []
    for (const node of nodes) {
      const d = node.data as Record<string, unknown>
      if (typeof d.mediaId === 'string') mediaIds.push(d.mediaId)
      if (Array.isArray(d.historyIds)) {
        for (const hid of d.historyIds) {
          if (typeof hid === 'string') mediaIds.push(hid)
        }
      }
      if (Array.isArray(d.frameIds)) {
        for (const fid of d.frameIds) {
          if (typeof fid === 'string') mediaIds.push(fid)
        }
      }
    }

    // Read settings
    let settings = { model: 'Gemini 3 Flash', doEmbed: false }
    try {
      const settingsJson = localStorage.getItem(LS_SETTINGS_KEY)
      if (settingsJson) {
        const s = JSON.parse(settingsJson)
        settings = { model: s.model ?? settings.model, doEmbed: s.doEmbed ?? false }
      }
    } catch { /* ignore */ }

    // Create project
    const project = await createProject('My Project', { nodes, edges, viewport }, settings)
    project.mediaIds = [...new Set(mediaIds)]
    await updateProject(project.id, { mediaIds: project.mediaIds })
    await setActiveProjectId(project.id)

    // Clean up localStorage
    localStorage.removeItem(LS_CANVAS_KEY)

    console.log(`[projectStore] Migrated localStorage canvas to project "${project.id}" with ${mediaIds.length} media refs`)
    return project.id
  } catch (err) {
    console.warn('[projectStore] Migration failed:', err)
    return null
  }
}
