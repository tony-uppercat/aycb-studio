import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'generateImage',
  label: 'Generate Image',
  icon: '✨',
  category: 'media-model',
  description: 'Generate an image from a prompt',
  defaultData: { prompt: '', selectedModel: 'gemini-3.1-flash-image-preview' },
  inputs: [
    { type: 'prompt', handleId: 'prompt-in' },
    { type: 'image', handleId: 'image-0' },
  ],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
