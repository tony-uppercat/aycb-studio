import type { LightConfig } from './types'

export interface GelPreset { name: string; hex: string; nb2: string }

export const GELS: GelPreset[] = [
  { name: 'CTO', hex: '#FF9633', nb2: 'warm orange CTO' },
  { name: 'CTB', hex: '#4D88FF', nb2: 'cool blue CTB' },
  { name: 'Magenta', hex: '#FF33AA', nb2: 'magenta' },
  { name: 'Cyan', hex: '#00E5FF', nb2: 'neon cyan' },
  { name: 'Amber', hex: '#FFAA00', nb2: 'deep amber' },
  { name: 'Lavender', hex: '#CC99FF', nb2: 'soft lavender' },
  { name: 'Pink', hex: '#FF1493', nb2: 'neon pink' },
  { name: 'Green', hex: '#39FF14', nb2: 'neon green' },
  { name: 'Red', hex: '#CC2200', nb2: 'deep red' },
  { name: 'Teal', hex: '#008080', nb2: 'teal' },
]

export const DEFAULT_LIGHTS: LightConfig[] = [
  { name: 'Key', on: false, azimuth: 295, elevation: 32, intensity: 85, kelvin: 4500, softness: 20, accent: '#e8a849', useGel: false, gelColor: '#FF9633' },
  { name: 'Fill', on: true, azimuth: 70, elevation: 50, intensity: 25, kelvin: 7000, softness: 90, accent: '#6fa8dc', useGel: false, gelColor: '#4D88FF' },
  { name: 'Rim', on: true, azimuth: 200, elevation: 30, intensity: 60, kelvin: 6500, softness: 20, accent: '#c084fc', useGel: true, gelColor: '#CC2200' },
]

export const LENS_PRESETS = [18, 25, 32, 40, 50, 75, 100, 135] as const
export const APERTURES = [1.4, 2.0, 2.8, 4.0, 5.6, 8.0] as const

export interface CinemaLens { id: string; name: string; nb2: string }

export const CINEMA_LENSES: CinemaLens[] = [
  { id: 's4i', name: 'Cooke S4/i', nb2: 'Cooke S4/i prime, warm organic rendering, gentle highlight roll-off, smooth skin tones' },
  { id: 's7i', name: 'Cooke S7/i', nb2: 'Cooke S7/i full-frame prime, creamy bokeh, warm tonal character, subtle spherical aberration at edges' },
  { id: 'master', name: 'Zeiss Master', nb2: 'Zeiss Master Prime, clinical sharpness, neutral color, high micro-contrast, clean rendering' },
  { id: 'supreme', name: 'Zeiss Supreme', nb2: 'Zeiss Supreme Prime, modern clean rendering, subtle warmth, smooth round bokeh' },
  { id: 'primo', name: 'Primo', nb2: 'Panavision Primo prime, balanced rich color rendering, cinema-standard fall-off' },
  { id: 'primo70', name: 'Primo 70', nb2: 'Panavision Primo 70 large-format, creamy shallow focus, gentle flare, expansive frame' },
  { id: 'signature', name: 'ARRI Sig.', nb2: 'ARRI Signature Prime, soft highlight roll-off, organic flare, gentle vignette at edges' },
  { id: 'summilux', name: 'Summilux-C', nb2: 'Leica Summilux-C, contrasty compact rendering, crisp midtones, vintage character edge' },
  { id: 'k35', name: 'Canon K35', nb2: 'Canon K35 vintage prime, low contrast, warm amber flare, dreamy soft edges, filmic grain character' },
  { id: 'ultra', name: 'Ultra Prime', nb2: 'Zeiss Ultra Prime, sharp reliable rendering, neutral color, controlled flare, workhorse clarity' },
]

export const SENSOR_H = 24

export interface ARPreset { id: string; label: string; ratio: number; tag: string }

export const AR_PRESETS: ARPreset[] = [
  { id: '239', label: '2.39:1', ratio: 2.39, tag: 'Scope' },
  { id: '185', label: '1.85:1', ratio: 1.85, tag: 'Flat' },
  { id: '169', label: '16:9', ratio: 16 / 9, tag: 'HD' },
  { id: '32', label: '3:2', ratio: 3 / 2, tag: 'Photo' },
  { id: '43', label: '4:3', ratio: 4 / 3, tag: 'Classic' },
  { id: '11', label: '1:1', ratio: 1, tag: 'Square' },
  { id: '45', label: '4:5', ratio: 4 / 5, tag: 'IG Port' },
  { id: '916', label: '9:16', ratio: 9 / 16, tag: 'Vertical' },
]

export interface ModelPreset { id: string; name: string }

export const MODEL_PRESETS: ModelPreset[] = [
  { id: 'bust', name: 'Bust' },
  { id: 'head', name: 'Head' },
  { id: 'figure', name: 'Figure' },
  { id: 'car', name: 'Car' },
  { id: 'product', name: 'Product' },
  { id: 'sphere', name: 'Sphere' },
]
