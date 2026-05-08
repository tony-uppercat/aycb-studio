import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'switch',
  label: 'Switch',
  icon: '⇄',
  category: 'utility',
  description: 'Route between multiple connected inputs by index',
  defaultData: { activeChannel: 0 },
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
