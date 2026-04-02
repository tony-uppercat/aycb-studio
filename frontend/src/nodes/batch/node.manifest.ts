import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'batch',
  label: 'Batch',
  icon: '▦',
  category: 'utility',
  description: 'Collect multiple inputs into a visual grid',
  defaultData: {},
  inputs: [{ type: 'media', handleId: 'media-in' }],
  outputs: [
    { type: 'media', handleId: 'media-out' },
    { type: 'text', handleId: 'text-out' },
  ],
}

export default manifest
