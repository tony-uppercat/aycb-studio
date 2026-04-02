import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'generateVideo',
  label: 'Generate Video',
  icon: '\u{1F39E}',
  category: 'media-model',
  description: 'Generate a video from a prompt using AI video models',
  defaultData: { selectedModel: 'seedance-1.0-lite' },
  inputs: [
    { type: 'prompt', handleId: 'prompt-in' },
    { type: 'image', handleId: 'image-in' },
  ],
  outputs: [{ type: 'video', handleId: 'video-out' }],
}

export default manifest
