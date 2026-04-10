import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'generateVideo',
  label: 'Generate Video',
  icon: '\u{1F39E}',
  category: 'media-model',
  description: 'Generate a video from a prompt using AI video models',
  defaultData: { selectedModel: 'atlas-seedance-2.0', aspectRatio: '21:9' },
  inputs: [
    { type: 'prompt', handleId: 'prompt-in' },
  ],
  outputs: [{ type: 'video', handleId: 'video-out' }],
}

export default manifest
