import type { Node, Edge } from '@xyflow/react'

interface ClipboardData {
  nodes: Node[]
  edges: Edge[]
}

interface ClipboardRef {
  current: ClipboardData | null
}

declare global {
  interface Window {
    __canvasClipboard?: ClipboardRef
  }
}

function makeStore(): ClipboardRef {
  if (typeof window === 'undefined') return { current: null }
  if (!window.__canvasClipboard) {
    window.__canvasClipboard = { current: null }
  }
  return window.__canvasClipboard
}

export const canvasClipboard = makeStore()

if (typeof window !== 'undefined') {
  console.log('[clipboardStore] module loaded — canvasClipboard at window.__canvasClipboard')
}
