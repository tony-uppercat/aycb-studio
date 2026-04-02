import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageAnalysis',
  label: 'Image Analysis',
  icon: '🔬',
  category: 'llm',
  description: 'Analyze an image with a vision model and extract text or JSON',
  defaultData: { prompt: '' },
  inputs: [
    { type: 'image', handleId: 'image-in' },
    { type: 'prompt', handleId: 'prompt-in' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
