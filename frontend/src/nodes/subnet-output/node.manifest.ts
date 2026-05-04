import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'subnet-output',
  label: 'Subnet Output',
  icon: '📤',
  category: 'utility',
  description: 'Proxy output pin for a subnet — forwards data to the parent level',
  defaultData: {
    handle_id: '',
    name: 'output',
    slot_type: 'text',
  },
  inputs: [{ type: 'text', handleId: 'in' }],
  outputs: [],
}

export default manifest
