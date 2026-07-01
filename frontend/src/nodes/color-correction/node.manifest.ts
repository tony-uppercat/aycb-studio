import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'colorCorrection',
  label: 'Color Correction',
  icon: '🎨',
  category: 'utility',
  description: 'Adjust brightness, contrast, and saturation of an image',
  defaultData: { brightness: 100, contrast: 100, saturation: 100 },
  inputs: [{ type: 'image', handleId: 'image-in' }],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
