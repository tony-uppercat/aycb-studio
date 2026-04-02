import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageCompare',
  label: 'Image Compare',
  icon: '🔍',
  category: 'utility',
  description: 'Side-by-side image comparison with a draggable slider',
  defaultData: {},
  inputs: [
    { type: 'image', handleId: 'image-0' },
    { type: 'image', handleId: 'image-1' },
  ],
  outputs: [],
}

export default manifest
