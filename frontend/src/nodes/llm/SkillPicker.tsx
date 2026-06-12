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
  const [open, setOpen] = useState(false)

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

  const summary = value.length
    ? `Skills (${value.length}): ${value.slice(0, 2).join(', ')}${value.length > 2 ? ', …' : ''}`
    : 'Skills: none selected'

  return (
    <div className="nodrag">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={value.join(', ') || 'No skills selected'}
        style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', background: 'none', border: 'none', padding: '2px 0', fontSize: 10, opacity: 0.8, cursor: 'pointer', color: 'inherit', textAlign: 'left' }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s', flexShrink: 0 }}><path d="M9 6l6 6-6 6V6z"/></svg>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
      </button>
      {open && (
        <div className="nowheel" style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 0 2px 14px' }}>
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
      )}
    </div>
  )
}
