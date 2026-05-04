import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'subnet',
  label: 'Subnet',
  icon: '📦',
  category: 'utility',
  description:
    'Black-box container with nested sub-graph and explicit I/O pins',
  defaultData: {
    name: 'Subnet',
    color: null,
    collapsed: false,
    sub_graph: {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    external_inputs: [],
    external_outputs: [],
  },
  inputs: [],
  outputs: [],
}

export default manifest
