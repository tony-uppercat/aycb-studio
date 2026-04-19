/**
 * Pull-based data reading utilities.
 *
 * NO automatic propagation — nodes explicitly pull data from upstream
 * when they Run. This eliminates timing issues, data overwrites, and
 * the need for multi-render-cycle propagation chains.
 *
 * Exception: subnet-input proxies are transparent. When resolveSource
 * encounters one, it walks up the subnet tree to the parent-level
 * external edge and continues resolution there. No Run needed on the
 * proxy — the boundary is reactive.
 */
import type { Node, Edge } from '@xyflow/react'
import { loadMedia } from '../mediaStore'
import { getRootTree } from './rootTreeGetter'
import { findNodePathInTree, resolveLevel } from './subnetTreeHelpers'

export function getHandleType(handleId: string | null | undefined): string {
  if (!handleId) return ''
  // Strip directional suffixes (-in, -out), numeric suffixes (-0, -1), and named suffixes (-system, -alt, etc.)
  return handleId.split('-')[0]
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

  // Subnet source: caller is pulling from an external output handle on a subnet
  // container. Walk into sub_graph and find the subnet-output proxy whose
  // handle_id matches. Caller then reads proxy.data.result via the fallback chain.
  if (node.type === 'subnet') {
    const sub_graph = d.sub_graph as { nodes: Node[] } | undefined
    if (!sub_graph) return null
    const proxy = sub_graph.nodes.find(
      (n) =>
        n.type === 'subnet-output' &&
        (n.data as Record<string, unknown>).handle_id === handleId,
    )
    return proxy ?? null
  }

  // Subnet-input source: caller is pulling from a subnet-input proxy INSIDE
  // a subnet. Instead of returning the proxy and letting the caller read
  // its (possibly stale) `data.result`, walk UP the tree to the parent
  // subnet's external edge and continue resolution at the parent level.
  // This makes the boundary reactive — the consumer always sees the
  // latest value of the external upstream, no Run required on the proxy.
  if (node.type === 'subnet-input') {
    const proxyHandleId = (d.handle_id as string | undefined) ?? ''
    const { root_nodes, root_edges } = getRootTree()
    const path = findNodePathInTree(root_nodes, sourceId)
    if (!path || path.length === 0) {
      // Orphan — no containing subnet; nothing external to read.
      return null
    }
    const parent_subnet_id = path[path.length - 1]
    const parent_path = path.slice(0, -1)
    const parent_level = resolveLevel(root_nodes, root_edges, parent_path)
    const parent_edge = parent_level.edges.find(
      (e) => e.target === parent_subnet_id && e.targetHandle === proxyHandleId,
    )
    if (!parent_edge) return null // no external connection — return '' downstream
    return resolveSource(
      parent_edge.source,
      parent_edge.sourceHandle ?? '',
      () => parent_level.nodes,
      () => parent_level.edges,
      depth + 1,
    )
  }

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
  const src = resolveSource(edge.source, edge.sourceHandle ?? '', getNodes, getEdges)
  if (!src) return ''
  const d = src.data as Record<string, unknown>

  // Per-pin output data (for dynamic outputs like JsonParser unpack pins)
  const outputPins = d.outputPins as Record<string, string> | undefined
  if (outputPins && edge.sourceHandle && edge.sourceHandle in outputPins) {
    return outputPins[edge.sourceHandle]
  }

  return (d.outputText as string) || (d.text as string) || (d.prompt as string) || (d.result as string) || ''
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
  const src = resolveSource(edge.source, edge.sourceHandle ?? '', getNodes, getEdges)
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

  if (!file && d.result instanceof File) {
    file = d.result
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
