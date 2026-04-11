import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'subnet-input',
  label: 'Subnet Input',
  icon: 'CornerRightDown',
  category: 'utility',
  description: 'Proxy input pin for a subnet — forwards data from the parent level',
  defaultData: {
    handle_id: '',
    name: 'input',
    slot_type: 'text',
  },
  inputs: [],
  outputs: [{ type: 'text', handleId: 'out' }],
}

export default manifest
