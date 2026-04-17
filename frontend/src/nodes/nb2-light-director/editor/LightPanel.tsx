import type { LightConfig } from '../types'
import { GELS } from '../constants'
import { kelvinHex, kelvinName, azToClock } from '../prompt-utils'

// ── Slider ──

interface SliderProps {
  label: string; value: number; min: number; max: number
  step?: number; unit?: string; onChange: (v: number) => void; color?: string
}

function Slider({ label, value, min, max, step = 1, unit = '', onChange, color = '#e8a849' }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: '#5a5752', letterSpacing: '0.06em' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#ddd', fontWeight: 600 }}>
          {step < 1 ? value.toFixed(1) : value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{
          width: '100%', height: 3, appearance: 'none',
          background: `linear-gradient(90deg,${color} ${pct}%,#333338 ${pct}%)`,
          borderRadius: 2, outline: 'none', cursor: 'pointer',
        }} />
    </div>
  )
}

export { Slider }

// ── Gel Picker ──

function GelPicker({ gelColor, onChange }: { gelColor: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6, marginTop: 2 }}>
      {GELS.map(g => (
        <button key={g.hex} title={g.name} onClick={() => onChange(g.hex)} style={{
          width: 19, height: 19, borderRadius: 3,
          border: gelColor === g.hex ? '2px solid #fff' : '1px solid #2a2a2a',
          background: g.hex, cursor: 'pointer', padding: 0,
          boxShadow: gelColor === g.hex ? `0 0 6px ${g.hex}50` : 'none',
          transition: 'all 0.15s',
        }} />
      ))}
      <div style={{ position: 'relative', width: 19, height: 19 }}>
        <input type="color" value={gelColor} onChange={e => onChange(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
        <div style={{
          width: 19, height: 19, borderRadius: 3, border: '1px dashed #444',
          background: 'conic-gradient(red,yellow,lime,aqua,blue,magenta,red)', pointerEvents: 'none',
        }} />
      </div>
    </div>
  )
}

// ── Light Panel ──

interface LightPanelProps {
  light: LightConfig; index: number
  onUpdate: (i: number, v: LightConfig) => void
  open?: boolean; onToggle: () => void
}

export function LightPanel({ light, index, onUpdate, open = true, onToggle }: LightPanelProps) {
  const u = (k: keyof LightConfig, v: LightConfig[keyof LightConfig]) =>
    onUpdate(index, { ...light, [k]: v })
  const ac = light.useGel ? light.gelColor : light.accent
  const expanded = open && light.on

  const azFrame = (az: number) => {
    const n = ((az % 360) + 360) % 360
    if (n >= 337.5 || n < 22.5) return 'directly in front'
    if (n < 67.5) return 'front-right'
    if (n < 112.5) return 'frame-right'
    if (n < 157.5) return 'rear-right'
    if (n < 202.5) return 'directly behind'
    if (n < 247.5) return 'rear-left'
    if (n < 292.5) return 'frame-left'
    return 'front-left'
  }

  return (
    <div style={{
      background: light.on ? '#1f1f23' : '#1a1a1d', border: `1px solid ${light.on ? '#353539' : '#2c2c30'}`,
      borderRadius: 7, padding: '9px 11px', marginBottom: 5, opacity: light.on ? 1 : 0.4, transition: 'all 0.2s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded ? 8 : 0 }}>
        <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}>
          <span style={{ fontSize: 8, color: '#444' }}>{open ? '\u25BE' : '\u25B8'}</span>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: light.on ? ac : '#333',
            boxShadow: light.on ? `0 0 7px ${ac}40` : 'none' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: light.on ? '#ddd' : '#444',
            textTransform: 'uppercase' }}>{light.name}</span>
          {!open && light.on && (
            <span style={{ fontSize: 8, color: '#444' }}>
              {light.useGel ? (GELS.find(g => g.hex === light.gelColor)?.name || '') : `${light.kelvin}K`} · {light.intensity}%
            </span>
          )}
        </div>
        <button onClick={() => u('on', !light.on)} style={{
          background: light.on ? ac + '15' : '#161618', border: `1px solid ${light.on ? ac + '35' : '#222'}`,
          color: light.on ? ac : '#444', fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
          cursor: 'pointer', letterSpacing: '0.06em',
        }}>{light.on ? 'ON' : 'OFF'}</button>
      </div>

      {expanded && (<>
        <Slider label="AZIMUTH" value={light.azimuth} min={0} max={359} unit="\u00B0" onChange={v => u('azimuth', v)} color={ac} />
        <Slider label="ELEVATION" value={light.elevation} min={0} max={90} unit="\u00B0" onChange={v => u('elevation', v)} color={ac} />
        <Slider label="INTENSITY" value={light.intensity} min={0} max={100} unit="%" onChange={v => u('intensity', v)} color={ac} />

        <div style={{ display: 'flex', gap: 0, marginBottom: 5, marginTop: 1 }}>
          {(['KELVIN', 'GEL'] as const).map(mode => {
            const active = mode === 'KELVIN' ? !light.useGel : light.useGel
            return (
              <button key={mode} onClick={() => u('useGel', mode === 'GEL')} style={{
                flex: 1, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', padding: '3px 0', cursor: 'pointer',
                background: active ? '#2e2e32' : 'transparent', color: active ? '#ddd' : '#444',
                border: `1px solid ${active ? '#2a2a2c' : '#2e2e32'}`,
                borderRadius: mode === 'KELVIN' ? '3px 0 0 3px' : '0 3px 3px 0',
              }}>{mode}</button>
            )
          })}
        </div>

        {!light.useGel
          ? <Slider label="KELVIN" value={light.kelvin} min={1800} max={10000} step={100} unit="K"
              onChange={v => u('kelvin', v)} color={kelvinHex(light.kelvin)} />
          : <GelPicker gelColor={light.gelColor} onChange={v => u('gelColor', v)} />
        }
        <Slider label="SOFTNESS" value={light.softness} min={0} max={100} unit="%" onChange={v => u('softness', v)} color={ac} />

        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid #2e2e32' }}>
          <span style={{ fontSize: 8, color: '#444' }}>
            {azToClock(light.azimuth)}h · {light.useGel ? (GELS.find(g => g.hex === light.gelColor)?.name || 'custom') : kelvinName(light.kelvin)}
          </span>
          <span style={{ fontSize: 8, color: '#444' }}>{azFrame(light.azimuth)}</span>
        </div>
      </>)}
    </div>
  )
}
