import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'imageEdit',
  label: 'Image Edit',
  icon: '🖌',
  category: 'media-model',
  description: 'Edit images using Vertex AI Imagen — inpainting, background swap, outpainting',
  defaultData: {
    edit_mode: 'EDIT_MODE_DEFAULT',
    mask_mode: 'MASK_MODE_BACKGROUND',
    mask_dilation: 0.01,
    number_of_images: 1,
  },
  inputs: [{ type: 'image', handleId: 'image-in' }],
  outputs: [{ type: 'image', handleId: 'image-out' }],
}

export default manifest
