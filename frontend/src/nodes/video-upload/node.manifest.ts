import type { NodeManifest } from '../_shared/types'

const manifest: NodeManifest = {
  type: 'videoUpload',
  label: 'Video Upload',
  icon: '🎥',
  category: 'input',
  description: 'Upload a video file with frame capture and timeline scrubbing',
  defaultData: {},
  inputs: [],
  outputs: [{ type: 'video', handleId: 'video-out' }],
}

export default manifest
