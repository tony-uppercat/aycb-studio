import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'bracketParser',
  label: 'Bracket Parser',
  icon: '🔧',
  category: 'utility',
  description: 'Extract and edit [bracketed] text segments',
  defaultData: {},
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
