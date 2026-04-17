import type { LightConfig } from '../types'
import { GELS } from '../constants'

interface DiagramProps {
  lights: LightConfig[]
  camTheta: number
}

export function Diagram({ lights, camTheta }: DiagramProps) {
  const S = 120, C = S / 2, R = 40
  const camDeg = ((-camTheta * 180 / Math.PI) % 360 + 360) % 360
  const camRad = ((camDeg - 90) * Math.PI) / 180
  const cx2 = C + (R + 11) * Math.cos(camRad), cy2 = C + (R + 11) * Math.sin(camRad)
  const ta = camRad + Math.PI

  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} style={{ display: 'block', margin: '0 auto' }}>
      <circle cx={C} cy={C} r={R + 11} fill="none" stroke="#2c2c30" strokeWidth={0.5} />
      <circle cx={C} cy={C} r={R} fill="none" stroke="#333338" strokeWidth={0.5} strokeDasharray="2 3" />
      <circle cx={C} cy={C} r={5} fill="#2e2e32" stroke="#333" strokeWidth={0.5} />
      <polygon
        points={`${cx2 + 4.5 * Math.cos(ta - 0.45)},${cy2 + 4.5 * Math.sin(ta - 0.45)} ${cx2 + 4.5 * Math.cos(ta + 0.45)},${cy2 + 4.5 * Math.sin(ta + 0.45)} ${cx2 + 9 * Math.cos(ta)},${cy2 + 9 * Math.sin(ta)}`}
        fill="#e8a849" opacity={0.65}
      />
      {lights.filter(l => l.on).map((l, i) => {
        const az = ((l.azimuth - 90) * Math.PI) / 180
        const dist = R * (1 - l.elevation / 200)
        const lx = C + dist * Math.cos(az), ly = C + dist * Math.sin(az)
        const sr = 2.5 + (l.intensity / 100) * 3
        const col = l.useGel ? l.gelColor : l.accent
        return (
          <g key={i}>
            <circle cx={lx} cy={ly} r={sr + 4} fill={col + '10'} />
            <circle cx={lx} cy={ly} r={sr} fill={col} opacity={0.8} />
            <text x={lx} y={ly - sr - 3} textAnchor="middle" fill={col} fontSize={7} fontWeight="700"
              fontFamily="'IBM Plex Mono',monospace">{l.name[0]}</text>
          </g>
        )
      })}
      {([12, 3, 6, 9] as const).map(n => {
        const a = ({ 12: -90, 3: 0, 6: 90, 9: 180 } as const)[n] * Math.PI / 180
        return (
          <text key={n} x={C + (R + 20) * Math.cos(a)} y={C + (R + 20) * Math.sin(a) + 3}
            textAnchor="middle" fill="#333" fontSize={7} fontFamily="'IBM Plex Mono',monospace">{n}</text>
        )
      })}
    </svg>
  )
}
