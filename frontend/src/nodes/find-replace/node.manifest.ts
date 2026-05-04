import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'findReplace',
  label: 'Find Replace',
  icon: '🔍',
  category: 'utility',
  description: 'Find and replace text with multiple rules, regex support, and format options',
  defaultData: { rules: [{ find: '', replace: '' }] },
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
