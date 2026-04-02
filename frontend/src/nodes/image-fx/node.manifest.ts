import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageFx',
  label: 'Image FX',
  icon: '🎛',
  category: 'utility',
  description: 'Apply image effects like Canny edge detection or depth estimation',
  defaultData: { mode: 'off' },
  inputs: [{ type: 'image', handleId: 'image-in' }],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
