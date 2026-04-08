import { useEffect, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'
import styles from './ProjectGallery.module.css'

export interface PresetTemplate {
  id: string
  name: string
  description: string
  icon: string
  nodes: Node[]
  edges: Edge[]
}

// eslint-disable-next-line react-refresh/only-export-components
export const PRESETS: PresetTemplate[] = [
  {
    id: 'blank',
    name: 'Blank Canvas',
    description: 'Start from scratch',
    icon: '📄',
    nodes: [],
    edges: [],
  },
  {
    id: 'image-analysis',
    name: 'Image Analysis',
    description: 'Upload → Analyze → View result',
    icon: '🔍',
    nodes: [
      { id: 'img-1', type: 'imageUpload', position: { x: 60, y: 120 }, data: {} },
      { id: 'prompt-1', type: 'textInput', position: { x: 60, y: 340 }, data: { outputText: 'Describe this image in detail' } },
      { id: 'analysis-1', type: 'imageAnalysis', position: { x: 380, y: 120 }, data: {} },
      { id: 'result-1', type: 'resultViewer', position: { x: 700, y: 120 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'img-1', sourceHandle: 'image-out', target: 'analysis-1', targetHandle: 'image-in' },
      { id: 'e2', source: 'prompt-1', sourceHandle: 'text-out', target: 'analysis-1', targetHandle: 'prompt-in' },
      { id: 'e3', source: 'analysis-1', sourceHandle: 'text-out', target: 'result-1', targetHandle: 'text-in' },
    ],
  },
  {
    id: 'image-gen',
    name: 'Image Generation',
    description: 'Prompt → Generate → View',
    icon: '✨',
    nodes: [
      { id: 'prompt-1', type: 'textInput', position: { x: 60, y: 120 }, data: { outputText: 'A futuristic city at sunset, cinematic' } },
      { id: 'gen-1', type: 'generateImage', position: { x: 380, y: 120 }, data: { prompt: '', selectedModel: 'gemini-3.1-flash-image-preview' } },
    ],
    edges: [
      { id: 'e1', source: 'prompt-1', sourceHandle: 'text-out', target: 'gen-1', targetHandle: 'prompt-in' },
    ],
  },
  {
    id: 'compare-ab',
    name: 'A/B Compare',
    description: 'Two images → Visual slider comparison',
    icon: '🔀',
    nodes: [
      { id: 'img-a', type: 'imageUpload', position: { x: 60, y: 60 }, data: {} },
      { id: 'img-b', type: 'imageUpload', position: { x: 60, y: 320 }, data: {} },
      { id: 'compare-1', type: 'imageCompare', position: { x: 400, y: 120 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'img-a', sourceHandle: 'image-out', target: 'compare-1', targetHandle: 'image-0' },
      { id: 'e2', source: 'img-b', sourceHandle: 'image-out', target: 'compare-1', targetHandle: 'image-1' },
    ],
  },
  {
    id: 'llm-compare',
    name: 'LLM Compare',
    description: 'Two images → AI-powered comparison',
    icon: '⚖️',
    nodes: [
      { id: 'img-a', type: 'imageUpload', position: { x: 60, y: 60 }, data: {} },
      { id: 'img-b', type: 'imageUpload', position: { x: 60, y: 320 }, data: {} },
      { id: 'comp-1', type: 'comparison', position: { x: 400, y: 120 }, data: {} },
      { id: 'result-1', type: 'resultViewer', position: { x: 740, y: 120 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'img-a', sourceHandle: 'image-out', target: 'comp-1', targetHandle: 'image-0' },
      { id: 'e2', source: 'img-b', sourceHandle: 'image-out', target: 'comp-1', targetHandle: 'image-1' },
      { id: 'e3', source: 'comp-1', sourceHandle: 'text-out', target: 'result-1', targetHandle: 'text-in' },
    ],
  },
  {
    id: 'video-analysis',
    name: 'Video Analysis',
    description: 'Upload video → Analyze frames → View',
    icon: '🎬',
    nodes: [
      { id: 'vid-1', type: 'videoUpload', position: { x: 60, y: 120 }, data: {} },
      { id: 'analysis-1', type: 'videoAnalysis', position: { x: 380, y: 120 }, data: { nFrames: 3 } },
      { id: 'result-1', type: 'resultViewer', position: { x: 700, y: 120 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'vid-1', sourceHandle: 'video-out', target: 'analysis-1', targetHandle: 'video-in' },
      { id: 'e2', source: 'analysis-1', sourceHandle: 'text-out', target: 'result-1', targetHandle: 'text-in' },
    ],
  },
  {
    id: 'llm-chain',
    name: 'LLM Chain',
    description: 'Prompt → LLM → Result with text chaining',
    icon: '🧠',
    nodes: [
      { id: 'prompt-1', type: 'textInput', position: { x: 60, y: 120 }, data: { outputText: 'Write a haiku about coding' } },
      { id: 'llm-1', type: 'llm', position: { x: 380, y: 120 }, data: { prompt: '', systemPrompt: '', selectedModel: 'gemini-3.1-flash-lite-preview:thinking' } },
      { id: 'result-1', type: 'resultViewer', position: { x: 700, y: 120 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'prompt-1', sourceHandle: 'text-out', target: 'llm-1', targetHandle: 'prompt-in' },
      { id: 'e2', source: 'llm-1', sourceHandle: 'text-out', target: 'result-1', targetHandle: 'text-in' },
    ],
  },
  {
    id: 'img-to-img',
    name: 'Image to Image',
    description: 'Upload → Prompt → Re-generate',
    icon: '🎨',
    nodes: [
      { id: 'img-1', type: 'imageUpload', position: { x: 60, y: 60 }, data: {} },
      { id: 'prompt-1', type: 'textInput', position: { x: 60, y: 320 }, data: { outputText: 'Transform this into a watercolor painting' } },
      { id: 'gen-1', type: 'generateImage', position: { x: 400, y: 120 }, data: { prompt: '', selectedModel: 'gemini-3.1-flash-image-preview' } },
    ],
    edges: [
      { id: 'e1', source: 'img-1', sourceHandle: 'image-out', target: 'gen-1', targetHandle: 'image-0' },
      { id: 'e2', source: 'prompt-1', sourceHandle: 'text-out', target: 'gen-1', targetHandle: 'prompt-in' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (nodes: Node[], edges: Edge[]) => void
}

export function ProjectGallery({ open, onClose, onSelect }: Props) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Project Templates</span>
          <button className={styles.close} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.grid}>
          {PRESETS.map(p => (
            <button
              key={p.id}
              className={`${styles.card} ${hoveredId === p.id ? styles.cardHover : ''}`}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => { onSelect(p.nodes, p.edges); onClose() }}
            >
              <span className={styles.cardIcon}>{p.icon}</span>
              <span className={styles.cardName}>{p.name}</span>
              <span className={styles.cardDesc}>{p.description}</span>
              <span className={styles.cardNodes}>{p.nodes.length} nodes</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
