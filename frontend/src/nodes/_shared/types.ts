export type SlotType = 'text' | 'image' | 'video' | 'prompt' | 'media'
export type NodeCategory = 'input' | 'media-model' | 'llm' | 'utility'

export interface SlotDef {
  type: SlotType
  handleId: string
}

export interface NodeManifest {
  type: string
  label: string
  icon: string
  category: NodeCategory
  description: string
  defaultData: Record<string, unknown>
  inputs: SlotDef[]
  outputs: SlotDef[]
}

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  'input': 'Input',
  'media-model': 'Media Models',
  'llm': 'LLM',
  'utility': 'Utility',
}

/** Check if two slot types are connection-compatible. */
export function areSlotsCompatible(typeA: string, typeB: string): boolean {
  if (typeA === typeB) return true
  if ((typeA === 'prompt' && typeB === 'text') || (typeA === 'text' && typeB === 'prompt')) return true
  if (typeA === 'media' && (typeB === 'image' || typeB === 'video')) return true
  if ((typeA === 'image' || typeA === 'video') && typeB === 'media') return true
  return false
}

export function getCompatibleNodes(
  catalog: NodeManifest[],
  slotType: string,
  direction: 'input' | 'output'
): NodeManifest[] {
  return catalog.filter(entry => {
    const slots = direction === 'output' ? entry.inputs : entry.outputs
    return slots.some(s => areSlotsCompatible(s.type, slotType))
  })
}

export function findHandleForSlot(
  catalog: NodeManifest[],
  nodeType: string,
  slotType: SlotType,
  direction: 'in' | 'out'
): string | null {
  const entry = catalog.find(e => e.type === nodeType)
  if (!entry) return null
  const slots = direction === 'in' ? entry.inputs : entry.outputs
  const exact = slots.find(s => s.type === slotType)
  if (exact) return exact.handleId
  const compat = slots.find(s => areSlotsCompatible(s.type, slotType))
  if (compat) return compat.handleId
  return null
}

/** Map a numeric cost to a CSS class name for price-tier coloring.
 *  `cheap` = upper bound for green, `mid` = upper bound for yellow. */
export function priceTier(cost: number, cheap: number, mid: number): string {
  if (cost === 0) return 'priceFree'
  if (cost < cheap) return 'priceCheap'
  if (cost <= mid) return 'priceMid'
  return 'priceExpensive'
}
