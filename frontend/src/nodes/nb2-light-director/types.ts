export interface LightConfig {
  name: string
  on: boolean
  azimuth: number
  elevation: number
  intensity: number
  kelvin: number
  softness: number
  accent: string
  useGel: boolean
  gelColor: string
}

export interface CameraState {
  theta: number
  phi: number
  dist: number
  tx: number
  ty: number
  tz: number
}

export interface LensState {
  focal: number
  aperture: number
  glass: string
}

export interface GlbOffset {
  x: number
  y: number
  z: number
  s: number
}

export interface CamBookmark {
  name: string
  cam: CameraState
  lens: LensState
}

export interface SceneConfig {
  version: string
  mode: 'text' | '3d_ref'
  lights: LightConfig[]
  ambient: number
  camera: CameraState
  lens: LensState
  pin: CameraState | null
  bookmarks: CamBookmark[]
  model: {
    type: string
    glbRef: string | null
    rotation: { x: number; y: number; z: number }
    offset: GlbOffset
  }
  frameAR: string | null
}

export interface NB2LightDirectorNodeData {
  sceneConfig?: string
  prompt?: string
  capturedImage?: string
  [key: string]: unknown
}

export const DEFAULT_CAMERA: CameraState = { theta: 0, phi: 0.8, dist: 8, tx: 0, ty: 0, tz: 0 }
export const DEFAULT_LENS: LensState = { focal: 50, aperture: 2.0, glass: 's4i' }
export const DEFAULT_GLB_ROT = { x: 0, y: 0, z: 0 }
export const DEFAULT_GLB_OFFSET: GlbOffset = { x: 0, y: 0, z: 0, s: 1 }
