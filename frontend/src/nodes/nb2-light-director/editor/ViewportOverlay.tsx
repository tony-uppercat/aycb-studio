import { Camera, Bookmark, Pin, PinOff, X } from 'lucide-react'
import type { CameraState, LensState, CamBookmark } from '../types'
import { shotType } from '../prompt-utils'
import { CINEMA_LENSES, AR_PRESETS } from '../constants'

interface ViewportOverlayProps {
  cam: CameraState
  lens: LensState
  pinnedCam: CameraState | null
  useRef3D: boolean
  frameAR: string | null
  camBookmarks: CamBookmark[]
  model: string
  glbRot: { x: number; y: number; z: number }
  clayMode: boolean
  onCapture: () => void
  onSaveBookmark: () => void
  onLoadBookmark: (bm: CamBookmark) => void
  onDeleteBookmark: (i: number) => void
  onTogglePin: () => void
  onSetFrameAR: (v: string | null) => void
  onSetClayMode: (v: boolean) => void
  onSetGlbRot: (fn: (r: { x: number; y: number; z: number }) => { x: number; y: number; z: number }) => void
}

export function ViewportOverlay({
  cam, lens, pinnedCam, useRef3D, frameAR, camBookmarks, model, glbRot, clayMode,
  onCapture, onSaveBookmark, onLoadBookmark, onDeleteBookmark, onTogglePin, onSetFrameAR, onSetClayMode, onSetGlbRot,
}: ViewportOverlayProps) {
  const camDeg = Math.round((((-cam.theta * 180 / Math.PI) % 360) + 360) % 360)
  const camElDeg = Math.round((Math.PI / 2 - cam.phi) * 180 / Math.PI)
  const curShot = shotType(cam.dist, lens.focal)

  return (
    <>
      {/* AR frame overlay */}
      {frameAR && (() => {
        const ar = AR_PRESETS.find(a => a.id === frameAR)
        if (!ar) return null
        return (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
              width: ar.ratio >= 1 ? '50%' : `${50 * ar.ratio}%`, height: 0,
              paddingBottom: ar.ratio >= 1 ? `${50 / ar.ratio}%` : '50%',
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.15)', position: 'relative',
            }}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <div style={{ position: 'absolute', left: '33.33%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ position: 'absolute', left: '66.66%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ position: 'absolute', top: '33.33%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ position: 'absolute', top: '66.66%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.06)' }} />
              </div>
              <div style={{ position: 'absolute', top: 4, left: 6, fontSize: 8, color: 'rgba(255,255,255,0.25)', fontWeight: 700 }}>{ar.label}</div>
            </div>
          </div>
        )
      })()}

      {/* AR selector */}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 2, background: '#18181bcc', border: '1px solid #2e2e32', borderRadius: 4, padding: '3px 4px' }}>
        <button onClick={() => onSetFrameAR(null)} style={{ padding: '2px 5px', fontSize: 7, fontWeight: 700, cursor: 'pointer', background: !frameAR ? '#ffffff12' : 'transparent', color: !frameAR ? '#888' : '#333', border: '1px solid transparent', borderRadius: 2 }}>OFF</button>
        {AR_PRESETS.map(ar => (
          <button key={ar.id} onClick={() => onSetFrameAR(ar.id)} title={ar.tag} style={{
            padding: '2px 4px', fontSize: 7, fontWeight: frameAR === ar.id ? 700 : 500, cursor: 'pointer',
            background: frameAR === ar.id ? '#e8a84918' : 'transparent',
            border: `1px solid ${frameAR === ar.id ? '#e8a84930' : 'transparent'}`,
            color: frameAR === ar.id ? '#e8a849' : '#444', borderRadius: 2,
          }}>{ar.tag}</button>
        ))}
      </div>

      {/* Camera HUD */}
      <div style={{ position: 'absolute', top: 8, left: 8, background: '#18181bdd', border: '1px solid #2e2e32', borderRadius: 5, padding: '5px 9px', maxWidth: 280 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
          <span style={{ fontSize: 7, color: '#444', letterSpacing: '0.12em', fontWeight: 700 }}>CAMERA</span>
          <div style={{ display: 'flex', gap: 3 }}>
            <button onClick={onCapture} style={{
              background: useRef3D ? '#39FF1415' : '#24242800', border: `1px solid ${useRef3D ? '#39FF1440' : '#e8a84930'}`,
              color: useRef3D ? '#39FF14' : '#e8a849', fontSize: 7, fontWeight: 700, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 3,
            }}><Camera size={8} strokeWidth={2} /> CAPTURE</button>
            <button onClick={onSaveBookmark} style={{
              background: '#e8a84912', border: '1px solid #e8a84930', color: '#e8a849', fontSize: 7, fontWeight: 700, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 3,
            }}><Bookmark size={8} strokeWidth={2} /> SAVE</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
          <span><span style={{ color: '#555' }}>AZ </span><span style={{ color: '#e8a849' }}>{camDeg}{'\u00B0'}</span></span>
          <span><span style={{ color: '#555' }}>EL </span><span style={{ color: '#e8a849' }}>{camElDeg}{'\u00B0'}</span></span>
          <span style={{ color: '#e8a849' }}>{lens.focal}mm</span>
          <span style={{ color: '#555' }}>{curShot}</span>
        </div>
        <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>{CINEMA_LENSES.find(g => g.id === lens.glass)?.name || ''}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5, paddingTop: 5, borderTop: '1px solid #2e2e32' }}>
          <button onClick={onTogglePin} style={{
            padding: '2px 7px', fontSize: 7, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3,
            background: pinnedCam ? '#39FF1412' : '#e8a84912', border: `1px solid ${pinnedCam ? '#39FF1430' : '#e8a84930'}`,
            color: pinnedCam ? '#39FF14' : '#e8a849', borderRadius: 3,
          }}>{pinnedCam ? <><PinOff size={8} strokeWidth={2} /> UNPIN</> : <><Pin size={8} strokeWidth={2} /> PIN HERE</>}</button>
          {camBookmarks.map((bm, i) => (
            <div key={i} style={{ display: 'flex', gap: 0 }}>
              <button onClick={() => onLoadBookmark(bm)} style={{
                padding: '2px 6px', fontSize: 7, fontWeight: 600, cursor: 'pointer',
                background: '#242428', border: '1px solid #222', color: '#888', borderRadius: '3px 0 0 3px',
              }}>{bm.name}</button>
              <button onClick={() => onDeleteBookmark(i)} style={{
                padding: '2px 4px', fontSize: 7, fontWeight: 700, cursor: 'pointer',
                background: '#242428', border: '1px solid #222', borderLeft: 'none', color: '#444', borderRadius: '0 3px 3px 0',
              }}><X size={7} strokeWidth={2} /></button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 8, color: '#3a3a3a' }}>L-drag orbit / R-drag pan / scroll zoom</div>

      {/* GLB controls */}
      {model === 'custom' && (
        <div style={{ position: 'absolute', bottom: 8, right: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => onSetClayMode(!clayMode)} style={{
            padding: '2px 7px', fontSize: 8, fontWeight: 700,
            background: clayMode ? '#e8a84920' : '#242428', border: `1px solid ${clayMode ? '#e8a84940' : '#222'}`,
            color: clayMode ? '#e8a849' : '#555', borderRadius: 3, cursor: 'pointer',
          }}>{clayMode ? 'CLAY' : 'TEX'}</button>
          <span style={{ fontSize: 7, color: '#444' }}>ROT</span>
          {(['x', 'y', 'z'] as const).map(axis => (
            <div key={axis} style={{ display: 'flex', gap: 0 }}>
              <button onClick={() => onSetGlbRot(r => ({ ...r, [axis]: r[axis] - 90 }))} style={{
                width: 18, height: 18, fontSize: 8, fontWeight: 700, padding: 0,
                background: '#242428', border: '1px solid #222', color: '#666', borderRadius: '3px 0 0 3px', cursor: 'pointer',
              }}>-</button>
              <div style={{ fontSize: 8, fontWeight: 600, color: '#e8a849', background: '#161619', border: '1px solid #222', borderLeft: 'none', borderRight: 'none', padding: '0 4px', display: 'flex', alignItems: 'center', minWidth: 24, justifyContent: 'center' }}>
                {axis.toUpperCase()}{glbRot[axis]}{'\u00B0'}
              </div>
              <button onClick={() => onSetGlbRot(r => ({ ...r, [axis]: r[axis] + 90 }))} style={{
                width: 18, height: 18, fontSize: 8, fontWeight: 700, padding: 0,
                background: '#242428', border: '1px solid #222', color: '#666', borderRadius: '0 3px 3px 0', cursor: 'pointer',
              }}>+</button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
