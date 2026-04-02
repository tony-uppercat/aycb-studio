import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'textInput',
  label: 'Text Input',
  icon: '📝',
  category: 'input',
  description: 'Manual text or prompt input',
  defaultData: { outputText: '' },
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'prompt', handleId: 'text-out' }],
}

export default manifest
