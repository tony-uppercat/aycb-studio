import type { LightConfig, CameraState, LensState } from './types'
import { GELS, CINEMA_LENSES, SENSOR_H } from './constants'

// ── Color Utils ──

export function kelvinToRGB(k: number): [number, number, number] {
  const t = k / 100
  let r: number, g: number, b: number
  if (t <= 66) {
    r = 255
    g = Math.max(0, Math.min(255, 99.47 * Math.log(t) - 161.12))
    b = t <= 19 ? 0 : Math.max(0, Math.min(255, 138.52 * Math.log(t - 10) - 305.04))
  } else {
    r = Math.max(0, Math.min(255, 329.7 * Math.pow(t - 60, -0.1332)))
    g = Math.max(0, Math.min(255, 288.12 * Math.pow(t - 60, -0.0755)))
    b = 255
  }
  return [r / 255, g / 255, b / 255]
}

export function kelvinHex(k: number): string {
  const [r, g, b] = kelvinToRGB(k)
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function hexToRGB(hex: string): [number, number, number] {
  const c = hex.replace('#', '')
  return [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255]
}

// ── NB2 Language ──

export function kelvinName(k: number): string {
  if (k < 2400) return 'deep candlelight'
  if (k < 3000) return 'warm tungsten'
  if (k < 3500) return 'tungsten'
  if (k < 4500) return 'neutral warm'
  if (k < 5500) return 'daylight'
  if (k < 6500) return 'overcast daylight'
  if (k < 8000) return 'cool daylight'
  return 'deep cool blue'
}

export function azToClock(az: number): number {
  let c = Math.round(((((az % 360) + 360) % 360) / 30)) % 12
  return c === 0 ? 12 : c
}

function elDesc(el: number): string {
  if (el < 15) return 'at eye level'
  if (el < 35) return 'from slightly above'
  if (el < 55) return 'from above'
  if (el < 75) return 'from high above'
  return 'from directly overhead'
}

function lightVerb(el: number): string {
  if (el < 15) return 'raking across'
  if (el < 35) return 'falling across'
  if (el < 55) return 'casting down onto'
  if (el < 75) return 'pooling on'
  return 'pressing down onto'
}

function shadowStr(el: number, soft: number, int: number): string {
  if (int < 15) return ''
  const sh = soft < 35 ? 'sharp, defined' : soft < 65 ? 'moderate' : 'soft, diffused'
  const len = el < 25 ? 'long' : el < 50 ? 'medium' : 'short'
  return `, casting ${len} ${sh} shadows`
}

function gelName(hex: string): string { return GELS.find(g => g.hex === hex)?.nb2 || 'colored' }

// ── Frame-relative light direction ──

export function lightToFrame(lightAz: number, camAzDeg: number): string {
  const rel = ((lightAz - camAzDeg + 360) % 360)
  if (rel < 20 || rel >= 340) return 'on-axis with the camera, flat frontal light'
  if (rel < 55) return 'entering from frame-left at a front angle'
  if (rel < 100) return 'entering from frame-left'
  if (rel < 135) return 'from behind-left, creating rim light on the left edge'
  if (rel < 170) return 'from behind the subject, backlighting from the left'
  if (rel < 190) return 'from directly behind the subject, pure backlight'
  if (rel < 225) return 'from behind the subject, backlighting from the right'
  if (rel < 260) return 'from behind-right, creating rim light on the right edge'
  if (rel < 305) return 'entering from frame-right'
  return 'entering from frame-right at a front angle'
}

export function lightRole(lightAz: number, camAzDeg: number): string {
  const rel = ((lightAz - camAzDeg + 360) % 360)
  if (rel < 30 || rel >= 330) return 'frontal'
  if (rel < 80 || rel >= 280) return 'side'
  if (rel < 130 || rel >= 230) return 'three-quarter back'
  return 'backlight'
}

// ── Camera description ──

export function focalToFov(focal: number): number {
  return Math.max(8, Math.min(80, 2 * Math.atan(SENSOR_H / (2 * focal)) * 180 / Math.PI))
}

export function shotType(dist: number, focal: number): string {
  const fov = focalToFov(focal) * Math.PI / 180
  const visibleH = 2 * dist * Math.tan(fov / 2)
  const fill = 2.0 / visibleH
  if (fill > 1.5) return 'ECU'
  if (fill > 0.8) return 'CU'
  if (fill > 0.5) return 'MCU'
  if (fill > 0.3) return 'MS'
  if (fill > 0.15) return 'MWS'
  return 'WS'
}

export function dofDesc(aperture: number, _focal: number): string {
  if (aperture <= 1.4) return 'very shallow depth of field, large bokeh'
  if (aperture <= 2.0) return 'shallow depth of field, soft bokeh'
  if (aperture <= 2.8) return 'moderate depth of field'
  if (aperture <= 4.0) return 'moderate-deep depth of field'
  return 'deep depth of field, sharp background'
}

function describeCamera(azDeg: number, elDeg: number, shot: string, dist: number) {
  let framStr: string
  if (elDeg > 70) framStr = "bird's eye view, looking straight down onto the subject"
  else if (elDeg > 55) framStr = 'steep overhead angle, looking down onto the top of the subject'
  else if (elDeg < -30) framStr = 'extreme low angle, looking up at the subject from the ground'
  else if (elDeg < -10) framStr = 'low angle, looking up at the subject from below'
  else if (dist < 3) framStr = shot === 'ECU' ? 'extreme close-up detail shot, macro-like, filling the entire frame' : 'very tight framing, intimate distance'
  else if (dist > 16) framStr = 'wide establishing shot, subject small within the environment, surroundings dominant'
  else if (dist > 12) framStr = 'wide shot, full figure with generous environment visible'
  else {
    const descs: Record<string, string> = {
      ECU: 'extreme close-up, tight on the face filling the frame',
      CU: 'close-up, framed on head and shoulders',
      MCU: 'medium close-up, framed from chest up',
      MS: 'medium shot, framed from waist up showing torso and arms',
      MWS: 'medium wide shot, showing most of the body with some environment',
      WS: 'wide shot, revealing the full figure and surrounding environment',
    }
    framStr = descs[shot] || 'medium shot'
  }

  let camStr: string
  if (elDeg > 70) camStr = 'directly overhead'
  else if (elDeg > 55) camStr = 'steep overhead angle'
  else if (elDeg < -30) camStr = 'extreme low angle from the ground'
  else if (elDeg < -10) camStr = 'low angle from below'
  else {
    const el = elDeg < -3 ? 'slightly below eye level'
      : elDeg < 5 ? 'at eye level'
      : elDeg < 15 ? 'slightly elevated'
      : elDeg < 30 ? 'elevated'
      : elDeg < 45 ? 'high angle'
      : 'steep high angle'
    const n = ((azDeg % 360) + 360) % 360
    let az: string
    if (n >= 337.5 || n < 22.5) az = 'frontal view'
    else if (n < 67.5) az = 'three-quarter view from the right'
    else if (n < 112.5) az = 'profile from the right'
    else if (n < 157.5) az = 'three-quarter rear from the right, looking at the back of the subject'
    else if (n < 202.5) az = 'rear view, behind the subject'
    else if (n < 247.5) az = 'three-quarter rear from the left, looking at the back of the subject'
    else if (n < 292.5) az = 'profile from the left'
    else az = 'three-quarter view from the left'
    camStr = `${az}, ${el}`
  }
  return { framStr, camStr }
}

// ── Prompt Generation ──

export function generatePrompt(
  lights: LightConfig[], ambient: number,
  cam: CameraState, lens: LensState,
  pinnedCam: CameraState | null, useRef3D: boolean,
): string {
  const active = lights.filter(l => l.on && l.intensity > 5)
  if (!active.length) return 'Enable at least one light to generate a prompt.'

  const cDeg = (((-cam.theta * 180 / Math.PI) % 360) + 360) % 360
  const cEl = Math.round((Math.PI / 2 - cam.phi) * 180 / Math.PI)
  const curShot = shotType(cam.dist, lens.focal)
  const { framStr, camStr: camLine } = describeCamera(cDeg, cEl, curShot, cam.dist)

  const parts = active.map(l => {
    const col = l.useGel
      ? `${gelName(l.gelColor)} ${l.name.toLowerCase()}`
      : `${l.intensity > 75 ? 'strong ' : l.intensity < 40 ? 'subtle ' : ''}${kelvinName(l.kelvin)} ${l.name.toLowerCase()} at ${l.kelvin}K`
    const frameDir = lightToFrame(l.azimuth, cDeg)
    const role = lightRole(l.azimuth, cDeg)
    return `${col} ${lightVerb(l.elevation)} the subject, ${frameDir} (${elDesc(l.elevation)}, ${role})${shadowStr(l.elevation, l.softness, l.intensity)}`
  })
  const amb = ambient > 15 ? `Ambient fill at ${ambient}% lifts the shadow side.` : 'Deep shadows on the unlit side.'
  const lightBlock = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('. ') + '. ' + amb

  const glassInfo = CINEMA_LENSES.find(g => g.id === lens.glass)
  const glassStr = glassInfo ? glassInfo.nb2 : `${lens.focal}mm prime`
  const lensLine = `${glassStr}, ${lens.focal}mm at f/${lens.aperture}, ${dofDesc(lens.aperture, lens.focal)}`

  let compStr = ''
  const tx = cam.tx || 0, ty = cam.ty || 0, tz = cam.tz || 0
  const pTx = pinnedCam?.tx || 0, pTy = pinnedCam?.ty || 0, pTz = pinnedCam?.tz || 0
  const hOffset = -(tx - pTx) * Math.cos(cam.theta) + (tz - pTz) * Math.sin(cam.theta)
  const vOffset = -(ty - pTy)
  if (Math.abs(hOffset) > 0.3 || Math.abs(vOffset) > 0.3) {
    const hDir = hOffset > 0.3 ? 'frame-left' : hOffset < -0.3 ? 'frame-right' : ''
    const vDir = vOffset > 0.3 ? 'upper frame' : vOffset < -0.3 ? 'lower frame' : ''
    const pos = [hDir, vDir].filter(Boolean).join(', ')
    compStr = `, subject offset toward ${pos}`
  }

  if (useRef3D) {
    return `Keep the subject, pose, expression, and identity from the subject image exactly as they are. Match the lighting, camera angle, and framing from the 3D reference image. ${lightBlock} ${framStr}, ${lensLine}. Use the subject image for identity. Use the 3D reference for lighting and camera.`
  }

  let includeCam = true
  if (pinnedCam) {
    const dAz = Math.abs(cam.theta - pinnedCam.theta) * 180 / Math.PI
    const dEl = Math.abs(cam.phi - pinnedCam.phi) * 180 / Math.PI
    const dDist = Math.abs(cam.dist - pinnedCam.dist)
    includeCam = dAz > 5 || dEl > 3 || dDist > 0.5
  }

  const camBlock = includeCam ? ` ${framStr}, ${camLine}${compStr}.` : ''
  return `Keep the subject, pose, expression, and setting exactly as they are. ${lightBlock}${camBlock} ${lensLine}. Use the provided image as reference. Make sure the setting matches the original image.`
}

export function lightPos(az: number, el: number, d = 4.5): [number, number, number] {
  const a = az * Math.PI / 180, e = el * Math.PI / 180
  return [d * Math.cos(e) * Math.sin(a), d * Math.sin(e), d * Math.cos(e) * Math.cos(a)]
}
