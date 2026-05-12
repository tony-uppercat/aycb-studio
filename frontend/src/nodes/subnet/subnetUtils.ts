import type { Node, Edge } from '@xyflow/react'
import type { SlotType } from '../_shared/types'
import { pullText, pullMedia } from '../../hooks/useDataPropagation'

/**
 * Force a string into snake_case: lowercase, non-alnum collapsed to single
 * underscore, trimmed, and prefixed with `_` if the result starts with a digit
 * (invalid identifier). Returns empty string if input yields nothing.
 */
export function toSnakeCase(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return ''
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
}


/**
 * Read a single incoming value by slot type — text/prompt via pullText,
 * everything else (image/video/media) via pullMedia with a file→mediaId
 * fallback. Shared between the input and output proxies so the dispatch
 * lives in one place.
 */
export async function pullBySlotType(
  slot_type: SlotType,
  node_id: string,
  handle_id: string,
  get_nodes: () => Node[],
  get_edges: () => Edge[],
): Promise<unknown> {
  if (slot_type === 'text' || slot_type === 'prompt') {
    return pullText(node_id, handle_id, get_nodes, get_edges)
  }
  const media = await pullMedia(node_id, handle_id, get_nodes, get_edges)
  return media.file ?? media.mediaId ?? null
}
