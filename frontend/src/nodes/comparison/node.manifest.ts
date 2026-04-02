import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'comparison',
  label: 'Comparison',
  icon: '⚖',
  category: 'llm',
  description: 'Compare two images using an LLM and output structured analysis',
  defaultData: {},
  inputs: [
    { type: 'image', handleId: 'image-0' },
    { type: 'image', handleId: 'image-1' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
