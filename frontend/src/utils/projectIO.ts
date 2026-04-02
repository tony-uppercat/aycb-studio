/**
 * Project export / import utilities.
 *
 * Export format (version 2):
 *   A gzip-compressed JSON file (.geminishot.gz) containing the canvas
 *   structure, settings, and a manifest of stored media files.  Media blobs
 *   are embedded as base64 data-URIs so the project is fully self-contained.
 *
 *   Version 1 (.json, uncompressed) is still accepted on import.
 */

import type { Node, Edge, Viewport } from '@xyflow/react'
import { loadMedia, saveMedia } from '../mediaStore'
import { serializeNodes } from '../hooks/useCanvasPersistence'
import { decompressToString, isGzipped } from './compress'
import { triggerDownload } from './downloadManager'

export const PROJECT_FORMAT_VERSION = 2

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProjectMediaItem {
  id: string
  name: string
  type: string
  /** Base64-encoded file content (no data-URI prefix). */
  dataB64: string
}

export interface ProjectExport {
  version: number
  timestamp: string
  canvas: {
    nodes: Node[]
    edges: Edge[]
    viewport?: Viewport
  }
  settings: {
    model: string
    doEmbed: boolean
  }
  media: ProjectMediaItem[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the "data:<type>;base64," prefix
      const b64 = result.split(',')[1] ?? result
      resolve(b64)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function base64ToBlob(b64: string, type: string): Blob {
  const binary = atob(b64)
  const len = binary.length
  const buf = new Uint8Array(len)
  for (let i = 0; i < len; i++) buf[i] = binary.charCodeAt(i)
  return new Blob([buf], { type })
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Serialize the entire project to a Blob that can be saved as a `.json` file.
 *
 * @param nodes   Current React Flow nodes
 * @param edges   Current React Flow edges
 * @param viewport Current viewport (pan/zoom)
 * @param settings Settings from SettingsContext (model, doEmbed)
 */
/**
 * Max media file size to embed in export (50MB).
 * Larger files (videos) are skipped to avoid "Invalid string length" errors.
 */
const MAX_MEDIA_EXPORT_SIZE = 50 * 1024 * 1024

export async function exportProject(
  nodes: Node[],
  edges: Edge[],
  viewport: Viewport,
  settings: { model: string; doEmbed: boolean },
): Promise<Blob> {
  // Collect only media referenced by canvas nodes (skip orphaned/large blobs)
  const referencedIds = new Set<string>()
  for (const n of nodes) {
    const d = n.data as Record<string, unknown>
    if (typeof d.mediaId === 'string') referencedIds.add(d.mediaId)
    if (Array.isArray(d.historyIds)) {
      for (const hid of d.historyIds) if (typeof hid === 'string') referencedIds.add(hid)
    }
    if (Array.isArray(d.frameIds)) {
      for (const fid of d.frameIds) if (typeof fid === 'string') referencedIds.add(fid)
    }
  }

  // Build JSON in streaming chunks to avoid "Invalid string length" on large projects.
  // Media base64 strings are written directly to the compression stream,
  // never assembled into a single massive string.
  const header: Omit<ProjectExport, 'media'> = {
    version: PROJECT_FORMAT_VERSION,
    timestamp: new Date().toISOString(),
    canvas: {
      nodes: serializeNodes(nodes),
      edges,
      viewport,
    },
    settings,
  }

  const headerJson = JSON.stringify(header, null, 2)
  const headerWithoutClose = headerJson.slice(0, -1)

  // Write each media item's base64 directly as a BlobPart — never pass it
  // through JSON.stringify (which would duplicate the huge string in memory).
  const mediaParts: BlobPart[] = []
  mediaParts.push(headerWithoutClose + ',\n  "media": [\n')

  let first = true
  let skipped = 0
  for (const mid of referencedIds) {
    const file = await loadMedia(mid)
    if (!file) continue
    if (file.size > MAX_MEDIA_EXPORT_SIZE) { skipped++; continue }
    const dataB64 = await fileToBase64(file)
    // Build JSON manually: write metadata as small string, base64 as separate part
    const escapedName = JSON.stringify(file.name) // handles special chars
    const prefix = first ? '    ' : ',\n    '
    mediaParts.push(
      `${prefix}{"id":${JSON.stringify(mid)},"name":${escapedName},"type":${JSON.stringify(file.type)},"dataB64":"`,
      dataB64, // raw base64 string — no JSON.stringify needed, base64 is JSON-safe
      '"}',
    )
    first = false
  }
  mediaParts.push('\n  ]\n}')

  if (skipped > 0) console.warn(`[export] Skipped ${skipped} media file(s) exceeding ${MAX_MEDIA_EXPORT_SIZE / 1024 / 1024}MB`)

  const jsonBlob = new Blob(mediaParts, { type: 'application/json' })

  // Compress with gzip if available
  if (typeof CompressionStream === 'undefined') return jsonBlob

  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  const buf = await jsonBlob.arrayBuffer()
  await writer.write(new Uint8Array(buf))
  await writer.close()

  const reader = cs.readable.getReader()
  const outChunks: BlobPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    outChunks.push(value)
  }

  return new Blob(outChunks, { type: 'application/gzip' })
}

/**
 * Download the exported project JSON to the user's machine.
 */
export async function downloadProject(
  nodes: Node[],
  edges: Edge[],
  viewport: Viewport,
  settings: { model: string; doEmbed: boolean },
): Promise<void> {
  const blob = await exportProject(nodes, edges, viewport, settings)
  triggerDownload(blob, `aycb-project-${new Date().toISOString().slice(0, 10)}.aycb.gz`)
}

export interface ImportResult {
  nodes: Node[]
  edges: Edge[]
  viewport?: Viewport
  settings: { model: string; doEmbed: boolean }
  mediaCount: number
}

/**
 * Parse a project file and restore its media into IndexedDB.
 * Accepts both v2 gzip-compressed (.geminishot.gz) and v1 plain JSON (.json).
 * Returns the canvas data so the caller can apply it to React Flow state.
 */
export async function importProject(file: File): Promise<ImportResult> {
  const gzipped = await isGzipped(file)
  const text = gzipped ? await decompressToString(file) : await file.text()
  // Use unknown so we can handle multiple formats safely
  const raw = JSON.parse(text) as Record<string, unknown>

  if (raw.version !== 1 && raw.version !== 2) {
    throw new Error(
      `Unsupported project version: ${raw.version}. Expected 1 or 2.`
    )
  }

  // ── Normalise nodes/edges ─────────────────────────────────────────────────
  // New format: { canvas: { nodes, edges, viewport } }
  // Old context-menu format: { nodes, edges } (flat)
  const canvasData = (raw.canvas as Record<string, unknown> | undefined) ?? raw
  const nodes = (canvasData.nodes as Node[]) ?? []
  const edges = (canvasData.edges as Edge[]) ?? []
  const viewport = canvasData.viewport as Viewport | undefined

  // ── Normalise media ───────────────────────────────────────────────────────
  // New format: media is an array  [{ id, name, type, dataB64 }]
  // Old context-menu format: media is an object map { "media-id": { name, type, dataB64 } }
  const rawMedia = raw.media
  let mediaItems: ProjectMediaItem[] = []
  if (Array.isArray(rawMedia)) {
    mediaItems = rawMedia as ProjectMediaItem[]
  } else if (rawMedia && typeof rawMedia === 'object') {
    // Convert object map → array, injecting the key as id
    mediaItems = Object.entries(rawMedia as Record<string, Omit<ProjectMediaItem, 'id'>>)
      .map(([id, item]) => ({ id, ...item }))
  }

  // Restore media into IndexedDB
  let mediaCount = 0
  for (const item of mediaItems) {
    try {
      const blob = base64ToBlob(item.dataB64, item.type)
      const restoredFile = new File([blob], item.name, { type: item.type })
      await saveMedia(item.id, restoredFile)
      mediaCount++
    } catch {
      // Non-fatal — skip broken entries
    }
  }

  return {
    nodes,
    edges,
    viewport,
    settings: (raw.settings as ImportResult['settings']) ?? { model: 'Gemini 2.5 Flash', doEmbed: false },
    mediaCount,
  }
}
