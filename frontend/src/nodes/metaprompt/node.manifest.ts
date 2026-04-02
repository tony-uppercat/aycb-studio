import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'metaprompt',
  label: 'Metaprompt',
  icon: '🎨',
  category: 'llm',
  description: 'Compare original and overpainted images to generate an image prompt',
  defaultData: {},
  inputs: [
    { type: 'image', handleId: 'image-0' },
    { type: 'image', handleId: 'image-1' },
    { type: 'prompt', handleId: 'prompt-in' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
