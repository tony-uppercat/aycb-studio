/**
 * Pull-based data reading utilities.
 *
 * NO automatic propagation — nodes explicitly pull data from upstream
 * when they Run. This eliminates timing issues, data overwrites, and
 * the need for multi-render-cycle propagation chains.
 */
import type { Node, Edge } from '@xyflow/react'
import { loadMedia } from '../mediaStore'

export function getHandleType(handleId: string | null | undefined): string {
  if (!handleId) return ''
  const stripped = handleId.replace(/-(?:in|out)$/, '')
  return stripped.replace(/-\d+$/, '')
}

/**
 * Resolve the actual source node, following bypass chains.
 * If the source node is bypassed, follow its incoming edge to find the real source.
 */
function resolveSource(sourceId: string, handleId: string, getNodes: () => Node[], getEdges: () => Edge[], depth = 0): Node | null {
  if (depth > 20) return null // prevent infinite loops
  const node = getNodes().find(n => n.id === sourceId)
  if (!node) return null
  const d = node.data as Record<string, unknown>
  if (!d._bypassed) return node
  // Node is bypassed — follow its incoming edges to find the real upstream
  const incoming = getEdges().find(e => e.target === sourceId)
  if (!incoming) return null
  return resolveSource(incoming.source, handleId, getNodes, getEdges, depth + 1)
}

/**
 * Read text/prompt from the node connected to a given input handle.
 * Returns empty string if nothing is connected or no text is available.
 * Follows bypass chains to find the actual data source.
 */
export function pullText(
  nodeId: string,
  handleId: string,
  getNodes: () => Node[],
  getEdges: () => Edge[],
): string {
  const edge = getEdges().find(e => e.target === nodeId && e.targetHandle === handleId)
  if (!edge) return ''
  const src = resolveSource(edge.source, handleId, getNodes, getEdges)
  if (!src) return ''
  const d = src.data as Record<string, unknown>

  // Per-pin output data (for dynamic outputs like JsonParser unpack pins)
  const outputPins = d.outputPins as Record<string, string> | undefined
  if (outputPins && edge.sourceHandle && edge.sourceHandle in outputPins) {
    return outputPins[edge.sourceHandle]
  }

  return (d.outputText as string) || (d.text as string) || (d.prompt as string) || ''
}

/**
 * Read a media File from the node connected to a given input handle.
 * Tries the direct File reference first, then loads from IndexedDB via mediaId.
 */
export async function pullMedia(
  nodeId: string,
  handleId: string,
  getNodes: () => Node[],
  getEdges: () => Edge[],
): Promise<{ file: File | null; mediaId: string | null }> {
  const edge = getEdges().find(e => e.target === nodeId && e.targetHandle === handleId)
  if (!edge) return { file: null, mediaId: null }
  const src = resolveSource(edge.source, handleId, getNodes, getEdges)
  if (!src) return { file: null, mediaId: null }
  const d = src.data as Record<string, unknown>

  const mediaId = typeof d.mediaId === 'string' ? d.mediaId : null
  let file: File | null = null

  if (d.file instanceof File) {
    file = d.file
  } else if (d.imageFile instanceof File) {
    file = d.imageFile
  } else if (d.videoFile instanceof File) {
    file = d.videoFile
  } else if (mediaId) {
    file = await loadMedia(mediaId)
  }

  return { file, mediaId }
}

/**
 * Read ALL media files from multiple input handles (for LLM dynamic pins).
 * Scans all edges targeting handles matching the given prefix (e.g., 'media-').
 */
export async function pullAllMedia(
  nodeId: string,
  handlePrefix: string,
  getNodes: () => Node[],
  getEdges: () => Edge[],
): Promise<File[]> {
  const edges = getEdges().filter(
    e => e.target === nodeId && e.targetHandle?.startsWith(handlePrefix)
  )
  const files: File[] = []
  for (const edge of edges) {
    const src = resolveSource(edge.source, edge.targetHandle ?? '', getNodes, getEdges)
    if (!src) continue
    const d = src.data as Record<string, unknown>
    if (d.file instanceof File) {
      files.push(d.file)
    } else if (d.imageFile instanceof File) {
      files.push(d.imageFile)
    } else if (d.videoFile instanceof File) {
      files.push(d.videoFile)
    } else if (typeof d.mediaId === 'string') {
      const f = await loadMedia(d.mediaId)
      if (f) files.push(f)
    }
  }
  return files
}
