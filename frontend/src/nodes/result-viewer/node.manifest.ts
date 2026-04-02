import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'resultViewer',
  label: 'Result Viewer',
  icon: '📄',
  category: 'utility',
  description: 'Display text and JSON results from upstream nodes',
  defaultData: {},
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [],
}

export default manifest
