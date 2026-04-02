import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageUpload',
  label: 'Image Upload',
  icon: '📷',
  category: 'input',
  description: 'Upload or drag-and-drop an image with crop and split tools',
  defaultData: {},
  inputs: [],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
