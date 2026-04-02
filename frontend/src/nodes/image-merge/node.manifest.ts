import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageMerge',
  label: 'Image Merge',
  icon: '🧩',
  category: 'utility',
  description: 'Merge multiple images into a grid, strip, or collage',
  defaultData: { layout: 'grid', gap: 4, background: '#000000' },
  inputs: [{ type: 'image', handleId: 'image-in' }],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
