import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageUpload',
  label: 'Image',
  icon: '📷',
  category: 'input',
  description: 'Upload or drag-and-drop an image with crop and split tools',
  defaultData: {},
  inputs: [{ type: 'image', handleId: 'image-in' }],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
