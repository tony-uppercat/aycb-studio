import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'switch',
  label: 'Switch',
  icon: '⇄',
  category: 'utility',
  description: 'Route between multiple connected inputs by index',
  defaultData: { selectedIndex: 0 },
  inputs: [{ type: 'media', handleId: 'media-in' }],
  outputs: [{ type: 'media', handleId: 'media-out' }],
}

export default manifest
