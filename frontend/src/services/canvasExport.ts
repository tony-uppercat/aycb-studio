/**
 * Canvas export service — async file I/O extracted from
 * CanvasContextMenu so the menu stays focused on UI orchestration
 * (open / hover / close) while the heavy serialization + blob work
 * lives in a plainly-testable module.
 *
 * Every function here is sync-friendly: it takes data / callbacks as
 * arguments, returns a result, and never reads from React state. The
 * caller wraps each in its own `setBusy(...) + try/finally` block.
 */
import type { Node, Edge } from '@xyflow/react'
import { loadMedia } from '../mediaStore'
import { saveToAssets } from '../api'
import { serializeNodes } from '../hooks/useCanvasPersistence'
import { triggerDownload, downloadFile } from '../utils/downloadManager'
import type { CollageImage } from '../components/CollageEditor'


function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}


function getInternalEdges(nodes: Node[], allEdges: Edge[]): Edge[] {
  const nodeIds = new Set(nodes.map(n => n.id))
  return allEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
}


/**
 * Download each media blob referenced by mediaIds as an individual
 * file. Broken entries are silently skipped so a single corrupt row
 * doesn't abort the batch.
 */
export async function downloadMediaFiles(mediaIds: string[]): Promise<void> {
  for (const mid of mediaIds) {
    try {
      const file = await loadMedia(mid)
      if (!file) continue
      downloadFile(file, { filename: file.name || `${mid}.png` })
    } catch {
      /* skip broken entries */
    }
  }
}


/**
 * Push each media blob to the shared Assets directory via the bridge
 * endpoint. Same skip-on-error policy as downloadMediaFiles.
 */
export async function saveMediaToAssets(mediaIds: string[]): Promise<void> {
  for (const mid of mediaIds) {
    try {
      const file = await loadMedia(mid)
      if (!file) continue
      await saveToAssets(file)
    } catch {
      /* skip broken entries */
    }
  }
}


/**
 * Package nodes + edges + full media blobs into a single `.geminishot.json`
 * download. Media is base64-embedded so the file is fully
 * self-contained and can be re-imported on another machine.
 */
export async function downloadNodesFull(
  selectedNodes: Node[],
  allEdges: Edge[],
  mediaIds: string[],
): Promise<void> {
  const internalEdges = getInternalEdges(selectedNodes, allEdges)
  const serialized = serializeNodes(selectedNodes)
  const mediaItems: Array<{ id: string; name: string; type: string; dataB64: string }> = []
  for (const mid of mediaIds) {
    try {
      const file = await loadMedia(mid)
      if (!file) continue
      const buf = await file.arrayBuffer()
      mediaItems.push({ id: mid, name: file.name, type: file.type, dataB64: arrayBufferToBase64(buf) })
    } catch {
      /* skip */
    }
  }
  const payload = {
    version: 1,
    timestamp: new Date().toISOString(),
    canvas: {
      nodes: serialized,
      edges: internalEdges.map(e => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
      })),
    },
    settings: { model: 'Gemini 3 Flash', doEmbed: false },
    media: mediaItems,
  }
  triggerDownload(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `nodes-${Date.now()}.geminishot.json`,
  )
}


/**
 * Build CollageEditor input from image nodes — each entry points to
 * a blob URL created here, so the caller should revoke the URLs when
 * the collage closes.
 */
export async function collectCollageImages(imageNodes: Node[]): Promise<CollageImage[]> {
  const collageImages: CollageImage[] = []
  for (const node of imageNodes) {
    const d = node.data as Record<string, unknown>
    const mediaId = d.mediaId as string
    try {
      const file = await loadMedia(mediaId)
      if (!file) continue
      const url = URL.createObjectURL(file)
      collageImages.push({ id: node.id, url, name: file.name || `image-${node.id}` })
    } catch {
      /* skip */
    }
  }
  return collageImages
}
