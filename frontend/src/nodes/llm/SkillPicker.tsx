import { useEffect, useState } from 'react'
import { api } from '../../api'

interface SkillInfo { name: string; description: string; source: string }

interface Props {
  value: string[]
  onChange: (next: string[]) => void
}

/** Checkbox list of Agent Skills the Claude-CLI LLM node can fire. Fetches the
 *  discoverable set once on mount (abortable). Knowledge-skills only — the
 *  backend pool excludes Bash/Write. */
export function SkillPicker({ value, onChange }: Props) {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    api.listSkills(ctrl.signal)
      .then(r => setSkills(r.skills))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Failed to load skills')
      })
    return () => ctrl.abort()
  }, [])

  const toggle = (name: string) => {
    onChange(value.includes(name) ? value.filter(n => n !== name) : [...value, name])
  }

  if (error) return <div style={{ fontSize: 10, opacity: 0.6 }}>Skills unavailable: {error}</div>
  if (!skills.length) return <div style={{ fontSize: 10, opacity: 0.6 }}>No skills found</div>

  return (
    <div className="nodrag nowheel" style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0' }}>
      {skills.map(s => (
        <label key={s.name} title={s.description} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
          <input
            type="checkbox"
            aria-label={s.name}
            checked={value.includes(s.name)}
            onChange={() => toggle(s.name)}
          />
          <span>{s.name}</span>
        </label>
      ))}
    </div>
  )
}
