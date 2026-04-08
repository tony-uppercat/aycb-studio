import type { Node, Edge } from '@xyflow/react'
import type {
  ImageAnalysisNodeData,
  VideoAnalysisNodeData,
  ResultViewerNodeData,
  ConsoleNodeData,
} from './types'
import { STORAGE_KEYS } from './storage/keys'

// ── User Templates ─────────────────────────────────────────────────────────────

export interface UserTemplate {
  id: string
  name: string
  description: string
  nodes: Node[]
  edges: Edge[]
  createdAt: string
  updatedAt?: string
}

export const USER_TEMPLATES_KEY = STORAGE_KEYS.USER_TEMPLATES

export function getUserTemplates(): UserTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(USER_TEMPLATES_KEY) ?? '[]')
  } catch { return [] }
}

export function saveUserTemplate(template: UserTemplate): void {
  const now = new Date().toISOString()
  const existing = getUserTemplates()
  existing.push({ ...template, updatedAt: now })
  localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(existing))
}

export function updateUserTemplate(
  id: string,
  updates: Partial<Pick<UserTemplate, 'name' | 'description' | 'nodes' | 'edges'>>,
): void {
  const templates = getUserTemplates()
  const idx = templates.findIndex(t => t.id === id)
  if (idx === -1) return
  templates[idx] = { ...templates[idx], ...updates, updatedAt: new Date().toISOString() }
  localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(templates))
}

export function findTemplateByName(name: string): UserTemplate | undefined {
  const lower = name.toLowerCase()
  return getUserTemplates().find(t => t.name.toLowerCase() === lower)
}

export function deleteUserTemplate(id: string): void {
  const existing = getUserTemplates().filter(t => t.id !== id)
  localStorage.setItem(USER_TEMPLATES_KEY, JSON.stringify(existing))
}

export const MODELS = ['Gemini 3.1 Pro', 'Gemini 3.1 Flash-Lite', 'Gemini 3 Flash']

export const DEFAULT_PRESET_NAME = 'Default'

export function getDefaultPreset(): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: [
      {
        id: 'image-1',
        type: 'imageAnalysis',
        position: { x: 60, y: 60 },
        data: { apiKey: '', model: MODELS[0], doEmbed: false } satisfies ImageAnalysisNodeData,
      },
      {
        id: 'video-1',
        type: 'videoAnalysis',
        position: { x: 60, y: 420 },
        data: { apiKey: '', model: MODELS[0], doEmbed: false, nFrames: 3 } satisfies VideoAnalysisNodeData,
      },
      {
        id: 'result-1',
        type: 'resultViewer',
        position: { x: 480, y: 60 },
        data: {} satisfies ResultViewerNodeData,
      },
      {
        id: 'console-1',
        type: 'console',
        position: { x: 480, y: 420 },
        data: {} satisfies ConsoleNodeData,
      },
    ],
    edges: [
      {
        id: 'e-image-result',
        source: 'image-1',
        sourceHandle: 'text',
        target: 'result-1',
        targetHandle: 'text',
      },
      {
        id: 'e-video-result',
        source: 'video-1',
        sourceHandle: 'text',
        target: 'result-1',
        targetHandle: 'text',
        style: { strokeDasharray: '5 5' },
      },
    ],
  }
}

export interface SavedPreset {
  name: string
  nodes: Node[]
  edges: Edge[]
}

export const LS_PRESETS_KEY = STORAGE_KEYS.PRESETS

/** One-time migration: geminishot_* → aycb_* localStorage keys */
const LS_MIGRATION_MAP: Record<string, string> = {
  'geminishot_canvas': 'aycb_canvas',
  'geminishot_settings': 'aycb_settings',
  'geminishot_feedback': 'aycb_feedback',
  'geminishot_fb_width': 'aycb_fb_width',
  'geminishot_presets': 'aycb_presets',
}

export function migrateStorageKeys(): void {
  for (const [oldKey, newKey] of Object.entries(LS_MIGRATION_MAP)) {
    const oldVal = localStorage.getItem(oldKey)
    if (oldVal !== null) {
      // Only copy if new key doesn't exist yet (don't overwrite newer data)
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, oldVal)
      }
      localStorage.removeItem(oldKey)
    }
  }
}
