import type { CameraState, LensState, CamBookmark, GlbOffset } from '../types'
import { CINEMA_LENSES, LENS_PRESETS, APERTURES } from '../constants'
import { dofDesc } from '../prompt-utils'
import { Slider } from './LightPanel'

// ── Camera Panel (sidebar) ──

interface CameraPanelProps {
  cam: CameraState
  lens: LensState
  shot: string
  onCamChange: (c: CameraState) => void
  onResetCam: () => void
  open: boolean
  onToggle: () => void
}

export function CameraPanel({ cam, lens: _lens, shot, onCamChange, onResetCam, open, onToggle }: CameraPanelProps) {
  const azDeg = Math.round((((-cam.theta * 180 / Math.PI) % 360) + 360) % 360)
  const elDeg = Math.round((Math.PI / 2 - cam.phi) * 180 / Math.PI)
  const dist = Math.round(cam.dist * 10) / 10

  return (
    <div style={{ background: '#1f1f23', border: '1px solid #353539', borderRadius: 7, padding: '9px 11px', marginBottom: 5 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: open ? 8 : 0, cursor: 'pointer' }}>
        <span style={{ fontSize: 8, color: '#444' }}>{open ? '\u25BE' : '\u25B8'}</span>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8a849', boxShadow: '0 0 5px #e8a84930' }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#ddd' }}>Camera</span>
        <span style={{ fontSize: 8, color: '#555' }}>{shot}</span>
      </div>
      {open && <>
        <Slider label="AZIMUTH" value={azDeg} min={0} max={359} unit="\u00B0"
          onChange={v => onCamChange({ ...cam, theta: -(v * Math.PI / 180) })} color="#e8a849" />
        <Slider label="ELEVATION" value={elDeg} min={-45} max={85} unit="\u00B0"
          onChange={v => onCamChange({ ...cam, phi: Math.PI / 2 - (v * Math.PI / 180) })} color="#e8a849" />
        <Slider label="DISTANCE" value={dist} min={2} max={20} step={0.1} unit=""
          onChange={v => onCamChange({ ...cam, dist: v })} color="#e8a849" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
          <button onClick={onResetCam} style={{
            background: 'none', border: '1px solid #222', color: '#555', fontSize: 7, fontWeight: 700,
            padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
          }}>RESET CAM</button>
        </div>
      </>}
    </div>
  )
}

// ── Lens Panel (sidebar) ──

interface LensPanelProps {
  lens: LensState
  onChange: (l: LensState) => void
  open: boolean
  onToggle: () => void
}

export function LensPanel({ lens, onChange, open, onToggle }: LensPanelProps) {
  return (
    <div style={{ background: '#1f1f23', border: '1px solid #353539', borderRadius: 7, padding: '9px 11px', marginBottom: 5 }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: open ? 8 : 0, cursor: 'pointer' }}>
        <span style={{ fontSize: 8, color: '#444' }}>{open ? '\u25BE' : '\u25B8'}</span>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8a849', boxShadow: '0 0 5px #e8a84930' }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#ddd' }}>Lens</span>
        <span style={{ fontSize: 8, color: '#555' }}>{CINEMA_LENSES.find(g => g.id === lens.glass)?.name}</span>
      </div>
      {open && <>
        <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.06em', marginBottom: 4 }}>GLASS</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
          {CINEMA_LENSES.map(g => (
            <button key={g.id} onClick={() => onChange({ ...lens, glass: g.id })} style={{
              padding: '3px 6px', fontSize: 8, fontWeight: lens.glass === g.id ? 700 : 500,
              background: lens.glass === g.id ? '#e8a84920' : 'transparent',
              border: `1px solid ${lens.glass === g.id ? '#e8a84940' : '#333338'}`,
              color: lens.glass === g.id ? '#e8a849' : '#555',
              borderRadius: 3, cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.3,
            }}>{g.name}</button>
          ))}
        </div>
        <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.06em', marginBottom: 4 }}>FOCAL LENGTH</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
          {LENS_PRESETS.map(f => (
            <button key={f} onClick={() => onChange({ ...lens, focal: f })} style={{
              padding: '3px 7px', fontSize: 9, fontWeight: lens.focal === f ? 700 : 500,
              background: lens.focal === f ? '#e8a84920' : 'transparent',
              border: `1px solid ${lens.focal === f ? '#e8a84940' : '#333338'}`,
              color: lens.focal === f ? '#e8a849' : '#666',
              borderRadius: 3, cursor: 'pointer', transition: 'all 0.15s',
            }}>{f}mm</button>
          ))}
        </div>
        <div style={{ fontSize: 8, color: '#555', letterSpacing: '0.06em', marginBottom: 4 }}>APERTURE</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {APERTURES.map(a => (
            <button key={a} onClick={() => onChange({ ...lens, aperture: a })} style={{
              padding: '3px 7px', fontSize: 9, fontWeight: lens.aperture === a ? 700 : 500,
              background: lens.aperture === a ? '#e8a84920' : 'transparent',
              border: `1px solid ${lens.aperture === a ? '#e8a84940' : '#333338'}`,
              color: lens.aperture === a ? '#e8a849' : '#666',
              borderRadius: 3, cursor: 'pointer', transition: 'all 0.15s',
            }}>f/{a}</button>
          ))}
        </div>
        <div style={{ paddingTop: 6, marginTop: 6, borderTop: '1px solid #2e2e32' }}>
          <div style={{ fontSize: 8, color: '#444' }}>{dofDesc(lens.aperture, lens.focal)}</div>
        </div>
      </>}
    </div>
  )
}

// ── Model Panel (GLB custom only) ──

interface ModelPanelProps {
  glbName: string | null
  glbOffset: GlbOffset
  onOffsetChange: (o: GlbOffset) => void
  open: boolean
  onToggle: () => void
}

export function ModelPanel({ glbName, glbOffset, onOffsetChange, open, onToggle }: ModelPanelProps) {
  return (
    <div style={{ background: '#1f1f23', border: '1px solid #c084fc30', borderRadius: 7, padding: '9px 11px', marginBottom: 5 }}>
      <div onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: open ? 8 : 0, cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 8, color: '#444' }}>{open ? '\u25BE' : '\u25B8'}</span>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#c084fc', boxShadow: '0 0 5px #c084fc30' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#ddd' }}>Model</span>
          {glbName && <span style={{ fontSize: 8, color: '#555' }}>{glbName}</span>}
        </div>
        <button onClick={e => { e.stopPropagation(); onOffsetChange({ x: 0, y: 0, z: 0, s: 1 }) }} style={{
          background: 'none', border: '1px solid #222', color: '#555', fontSize: 7, fontWeight: 700,
          padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
        }}>RESET</button>
      </div>
      {open && <>
        <Slider label="OFFSET X" value={glbOffset.x} min={-3} max={3} step={0.05} onChange={v => onOffsetChange({ ...glbOffset, x: v })} color="#c084fc" />
        <Slider label="OFFSET Y" value={glbOffset.y} min={-3} max={3} step={0.05} onChange={v => onOffsetChange({ ...glbOffset, y: v })} color="#c084fc" />
        <Slider label="OFFSET Z" value={glbOffset.z} min={-3} max={3} step={0.05} onChange={v => onOffsetChange({ ...glbOffset, z: v })} color="#c084fc" />
        <Slider label="SCALE" value={glbOffset.s} min={0.1} max={5} step={0.05} unit="\u00D7" onChange={v => onOffsetChange({ ...glbOffset, s: v })} color="#c084fc" />
      </>}
    </div>
  )
}
