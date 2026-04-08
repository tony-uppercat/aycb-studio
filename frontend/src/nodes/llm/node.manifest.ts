import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'llm',
  label: 'LLM',
  icon: '🧠',
  category: 'llm',
  description: 'Generate or transform text — choose Gemini or Claude',
  defaultData: { prompt: '', systemPrompt: '', selectedModel: 'gemini-3.1-flash-lite-preview:thinking' },
  inputs: [
    { type: 'text', handleId: 'text-system' },
    { type: 'prompt', handleId: 'prompt-in' },
    { type: 'media', handleId: 'media-0' },
  ],
  outputs: [{ type: 'text', handleId: 'text-out' }],
}

export default manifest
