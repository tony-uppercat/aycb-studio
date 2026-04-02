import type { ComponentType } from 'react'
import type { NodeManifest } from './_shared/types'

// Auto-discover all node manifests and components
const manifestModules = import.meta.glob<{ default: NodeManifest }>(
  './*/node.manifest.ts',
  { eager: true }
)
const componentModules = import.meta.glob<{ default: ComponentType<any> }>(
  './*/*Node.tsx',
  { eager: true }
)

// Build NODE_TYPES map for ReactFlow
export const NODE_TYPES: Record<string, ComponentType<any>> = {}

// Build NODE_CATALOG array for AddNodeMenu
export const NODE_CATALOG: NodeManifest[] = []

// Map of type -> manifest for lookups
export const MANIFEST_MAP: Record<string, NodeManifest> = {}

for (const [path, mod] of Object.entries(manifestModules)) {
  const manifest = mod.default
  if (!manifest?.type) continue

  // Find the matching component in the same folder
  const folder = path.split('/').slice(0, -1).join('/')
  const componentEntry = Object.entries(componentModules).find(
    ([cPath]) => cPath.startsWith(folder + '/')
  )

  if (componentEntry) {
    NODE_TYPES[manifest.type] = componentEntry[1].default
  }

  NODE_CATALOG.push(manifest)
  MANIFEST_MAP[manifest.type] = manifest
}

// Type aliases for backward compatibility with saved projects
if (NODE_TYPES['textInput']) NODE_TYPES['promptEditor'] = NODE_TYPES['textInput']
if (NODE_TYPES['llm']) NODE_TYPES['llmGemini'] = NODE_TYPES['llm']

// Re-export compatibility helpers
export { areSlotsCompatible, CATEGORY_LABELS, getCompatibleNodes, findHandleForSlot } from './_shared/types'
export type { NodeManifest, SlotDef, SlotType, NodeCategory } from './_shared/types'
