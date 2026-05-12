/**
 * Export all media of a project to a user-chosen filesystem directory.
 *
 * Uses the File System Access API (Chromium-only). The chosen directory
 * handle is persisted per projectId in a dedicated IndexedDB so the next
 * export reuses the same location without asking again (permission is
 * re-requested silently if the grant has lapsed across sessions).
 *
 * Files land in {chosen}/YYYY-MM-DD/ and same-name collisions within a
 * single export are resolved with a -N suffix.
 */
import { getProject } from '../stores/projectStore'
import { loadMedia } from '../mediaStore'

// Subset of File System Access API methods not yet in lib.dom.d.ts.
type PermissionMode = 'readwrite'
interface FsPermissionDescriptor { mode: PermissionMode }
interface FsHandlePermissions {
  queryPermission(opts: FsPermissionDescriptor): Promise<PermissionState>
  requestPermission(opts: FsPermissionDescriptor): Promise<PermissionState>
}
type DirHandle = FileSystemDirectoryHandle & FsHandlePermissions
interface ShowDirPickerWindow {
  showDirectoryPicker(opts?: { mode?: PermissionMode }): Promise<DirHandle>
}

const HANDLE_DB = 'aycb_export_handles'
const HANDLE_STORE = 'handles'

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getStoredHandle(projectId: string): Promise<DirHandle | null> {
  const db = await openHandleDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readonly')
    const req = tx.objectStore(HANDLE_STORE).get(projectId)
    req.onsuccess = () => { db.close(); resolve((req.result as DirHandle | undefined) ?? null) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

async function saveHandle(projectId: string, handle: DirHandle): Promise<void> {
  const db = await openHandleDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, 'readwrite')
    tx.objectStore(HANDLE_STORE).put(handle, projectId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

async function ensurePermission(handle: DirHandle): Promise<boolean> {
  const opts: FsPermissionDescriptor = { mode: 'readwrite' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function resolveUniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) return name
  const dot = name.lastIndexOf('.')
  const base = dot < 0 ? name : name.slice(0, dot)
  const ext = dot < 0 ? '' : name.slice(dot)
  let n = 1
  while (used.has(`${base}-${n}${ext}`)) n++
  return `${base}-${n}${ext}`
}

export interface ExportResult {
  written: number
  skipped: number
  dateFolder: string
  reusedPath: boolean
}

export async function exportProjectMedia(projectId: string): Promise<ExportResult> {
  const w = window as unknown as ShowDirPickerWindow
  if (typeof w.showDirectoryPicker !== 'function') {
    throw new Error('Folder picker not supported — use Chrome or Edge')
  }
  const project = await getProject(projectId)
  if (!project) throw new Error('Project not found')
  if (project.mediaIds.length === 0) throw new Error('No media in this project')

  let root = await getStoredHandle(projectId)
  let reusedPath = false
  if (root && await ensurePermission(root)) {
    reusedPath = true
  } else {
    root = await w.showDirectoryPicker({ mode: 'readwrite' })
    await saveHandle(projectId, root)
  }

  const dateFolder = todayIso()
  const subDir = await root.getDirectoryHandle(dateFolder, { create: true })

  const used = new Set<string>()
  let written = 0
  let skipped = 0
  for (const mediaId of project.mediaIds) {
    const file = await loadMedia(mediaId)
    if (!file) { skipped++; continue }
    const name = resolveUniqueName(file.name || `${mediaId}.bin`, used)
    used.add(name)
    const fh = await subDir.getFileHandle(name, { create: true })
    const writable = await fh.createWritable()
    await writable.write(file)
    await writable.close()
    written++
  }

  return { written, skipped, dateFolder, reusedPath }
}
