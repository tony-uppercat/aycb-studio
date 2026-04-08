import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'textNote',
  label: 'Text Note',
  icon: 'T',
  category: 'utility',
  description: 'Editable text annotation on canvas',
  defaultData: { text: 'New Note', fontSize: 12, fontFamily: 'system' },
  inputs: [],
  outputs: [],
}

export default manifest
