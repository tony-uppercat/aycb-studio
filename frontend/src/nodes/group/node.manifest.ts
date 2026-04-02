import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'group',
  label: 'Group',
  icon: '▢',
  category: 'utility',
  description: 'Container for organizing nodes — collapsible with custom colors',
  defaultData: { label: 'Group', color: '#333', collapsed: false },
  inputs: [],
  outputs: [],
}
export default manifest
