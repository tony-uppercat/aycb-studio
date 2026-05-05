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
 * Resolve the actual source node, following bypass and subnet boundary
 * chains. Returns the resolved node together with the source handle id
 * that should be used for per-pin lookups (outputPins, outputMediaIds).
 *
 * Why the handleId is part of the return value: across a subnet boundary
 * the OUTER edge's sourceHandle is the subnet's external pin id (e.g.
 * "out1"), while the INNER source's per-pin maps are keyed by the inner
 * handle id (e.g. "image-out", "text-out"). Returning just the node
 * would silently miss those per-pin values for multi-output nodes
 * (batch generateImage, bracketParser, ...).
 */
/**
 * Sync helper for reactive selectors that need the upstream mediaId without
 * actually loading the file. Mirrors the lookup pullMedia performs once
 * resolveSource has resolved the actual source — honors per-pin
 * outputMediaIds first (batch outputs, image-proxy passthrough), then falls
 * back to data.mediaId. Walks subnets and bypass chains via resolveSource,
 * so a consumer pulling from a subnet's external output reads the real
 * inner source's mediaId rather than the subnet's empty data.
 */
export function resolveSourceMediaId(
  sourceId: string,
  sourceHandleId: string,
  nodes: Node[],
  edges: Edge[],
): string | null {
  const result = resolveSource(sourceId, sourceHandleId, () => nodes, () => edges)
  if (!result) return null
  const { node, handleId } = result
  const d = node.data as Record<string, unknown>
  const outputMediaIds = d.outputMediaIds as Record<string, string> | undefined
  if (outputMediaIds && handleId && handleId in outputMediaIds) {
    return outputMediaIds[handleId]
  }
  return (d.mediaId as string) ?? null
}

/**
 * Sync helper for reactive selectors that display upstream text. Mirrors
 * pullText: walks subnets/bypass via resolveSource, reads per-pin outputPins
 * first (json/bracket parser dynamic outputs), then falls back to the
 * standard text fields. Without this, reactive previews (Result Viewer,
 * Generate Image active prompt, PromptEditor upstream text, etc.) read the
 * outer subnet's empty data and silently show nothing.
 */
export function resolveSourceText(
  sourceId: string,
  sourceHandleId: string,
  nodes: Node[],
  edges: Edge[],
): string {
  const result = resolveSource(sourceId, sourceHandleId, () => nodes, () => edges)
  if (!result) return ''
  const { node, handleId } = result
  const d = node.data as Record<string, unknown>
  const outputPins = d.outputPins as Record<string, string> | undefined
  if (outputPins && handleId && handleId in outputPins) {
    return outputPins[handleId]
  }
  return (d.outputText as string) || (d.text as string) || (d.prompt as string) || (d.result as string) || ''
}

function resolveSource(sourceId: string, handleId: string, getNodes: () => Node[], getEdges: () => Edge[], depth = 0): { node: Node; handleId: string } | null {
  if (depth > 20) return null // prevent infinite loops
  const node = getNodes().find(n => n.id === sourceId)
  if (!node) return null
  const d = node.data as Record<string, unknown>

  // Subnet source: caller is pulling from an external output handle on a
  // subnet container. Reactive boundary — walk DOWN into sub_graph, find
  // the subnet-output proxy whose handle_id matches, then follow the
  // internal edge feeding the proxy's 'in' handle and resolve at the inner
  // level. The consumer always sees the live upstream value, no Run on
  // the proxy required. Symmetric to the subnet-input walk-up below.
  if (node.type === 'subnet') {
    const sub_graph = d.sub_graph as { nodes: Node[]; edges: Edge[] } | undefined
    if (!sub_graph) return null
    const proxy = sub_graph.nodes.find(
      (n) =>
        n.type === 'subnet-output' &&
        (n.data as Record<string, unknown>).handle_id === handleId,
    )
    if (!proxy) return null
    const inner_edge = sub_graph.edges.find(
      (e) => e.target === proxy.id && e.targetHandle === 'in',
    )
    if (!inner_edge) return null
    return resolveSource(
      inner_edge.source,
      inner_edge.sourceHandle ?? '',
      () => sub_graph.nodes,
      () => sub_graph.edges,
      depth + 1,
    )
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

  if (!d._bypassed) return { node, handleId }
  // Node is bypassed — follow its incoming edges to find the real upstream
  const incoming = getEdges().find(e => e.target === sourceId)
  if (!incoming) return null
  return resolveSource(incoming.source, incoming.sourceHandle ?? handleId, getNodes, getEdges, depth + 1)
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
  const result = resolveSource(edge.source, edge.sourceHandle ?? '', getNodes, getEdges)
  if (!result) return ''
  const { node: src, handleId: srcHandle } = result
  const d = src.data as Record<string, unknown>

  // Per-pin output data (for dynamic outputs like JsonParser unpack pins).
  // srcHandle is the resolved handle on the actual source — across a subnet
  // boundary this is the inner handle, not the subnet's external pin id.
  const outputPins = d.outputPins as Record<string, string> | undefined
  if (outputPins && srcHandle && srcHandle in outputPins) {
    return outputPins[srcHandle]
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
  const result = resolveSource(edge.source, edge.sourceHandle ?? '', getNodes, getEdges)
  if (!result) return { file: null, mediaId: null }
  const { node: src, handleId: srcHandle } = result
  const d = src.data as Record<string, unknown>

  // Per-handle output media (batch outputs like Generate Image ×2/×4).
  // srcHandle is the resolved handle on the actual source — across a subnet
  // boundary this is the inner handle, not the subnet's external pin id.
  const outputMediaIds = d.outputMediaIds as Record<string, string> | undefined
  if (outputMediaIds && srcHandle && srcHandle in outputMediaIds) {
    const mid = outputMediaIds[srcHandle]
    const file = await loadMedia(mid)
    return { file, mediaId: mid }
  }

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
    const result = resolveSource(edge.source, edge.sourceHandle ?? '', getNodes, getEdges)
    if (!result) continue
    const { node: src, handleId: srcHandle } = result
    const d = src.data as Record<string, unknown>

    // Per-handle output media (batch outputs like Generate Image ×2/×4, and
    // Image-node proxy passthrough). Must take precedence over data.mediaId
    // so a proxying Image node exposes the upstream image instead of its
    // own preserved mediaId. Mirrors pullMedia.
    const outputMediaIds = d.outputMediaIds as Record<string, string> | undefined
    if (outputMediaIds && srcHandle && srcHandle in outputMediaIds) {
      const f = await loadMedia(outputMediaIds[srcHandle])
      if (f) files.push(f)
      continue
    }

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
