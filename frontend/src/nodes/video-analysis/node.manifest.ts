import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'videoAnalysis',
  label: 'Video Analysis',
  icon: '🎬',
  category: 'llm',
  description: 'Analyze video frames with a vision model and extract text or JSON',
  defaultData: { mode: 'sharp', maxFrames: 3 },
  inputs: [
    { type: 'video', handleId: 'video-in' },
    { type: 'prompt', handleId: 'prompt-in' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
