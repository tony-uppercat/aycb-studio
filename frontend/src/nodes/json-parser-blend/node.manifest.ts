import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'jsonParserBlend',
  label: 'JSON Blend',
  icon: '\u{1F500}',
  category: 'utility',
  description: 'Merge and blend multiple JSON objects with key selection',
  defaultData: { mode: 'json' },
  inputs: [{ type: 'text', handleId: 'text-in' }],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
