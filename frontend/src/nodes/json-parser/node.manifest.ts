import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'jsonParser',
  label: 'JSON Parser',
  icon: '🔧',
  category: 'utility',
  description: 'Parse JSON and extract values by path',
  defaultData: { jsonPath: '' },
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
