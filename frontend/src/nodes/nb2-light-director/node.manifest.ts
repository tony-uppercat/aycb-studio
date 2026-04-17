import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'nb2LightDirector',
  label: 'NB2 Light Director',
  icon: 'Lightbulb',
  category: 'utility',
  description: 'Cinematic lighting setup with 3D viewport — generates NB2-style lighting prompts',
  defaultData: {
    sceneConfig: '',
    prompt: '',
    capturedImage: '',
  },
  inputs: [
    { type: 'image', handleId: 'image-subject' },
    { type: 'text', handleId: 'text-preset' },
  ],
  outputs: [
    { type: 'prompt', handleId: 'prompt-out' },
    { type: 'image', handleId: 'image-ref' },
    { type: 'text', handleId: 'text-config' },
  ],
}

export default manifest
