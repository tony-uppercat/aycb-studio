import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'textCombine',
  label: 'Text Combine',
  icon: '📎',
  category: 'utility',
  description: 'Combine multiple text inputs with a configurable separator',
  defaultData: { separator: '\n' },
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
