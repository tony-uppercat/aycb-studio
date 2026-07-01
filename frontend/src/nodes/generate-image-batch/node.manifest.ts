import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'generateImageBatch',
  label: 'Generate Image Batch',
  icon: '≡',
  category: 'media-model',
  description: 'Async batch image generation via Gemini Batch API (50% discount, up to 24h SLA)',
  defaultData: {
    prompt: '',
    selectedModel: 'gemini-3-pro-image',
    aspectRatio: '16:9',
    resolution: '2K',
    bundleN: 5,
    bundleT: 30,
    pending: [],
    knownResultIds: [],
  },
  inputs: [
    { type: 'prompt', handleId: 'prompt-in' },
    { type: 'image', handleId: 'image-0' },
  ],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
