import { useEffect, useRef, useState } from 'react'

interface NameModalProps {
  initial_name: string
  on_confirm: (name: string) => void
}

export function NameModal({ initial_name, on_confirm }: NameModalProps) {
  const [name, setName] = useState(initial_name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const valid = name.trim().length >= 2

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    on_confirm(name.trim())
  }

  return (
    <div className="rh-name-modal-backdrop">
      <div className="rh-name-modal-card">
        <p className="rh-name-modal-welcome">Welcome to</p>
        <h1 className="rh-name-modal-brand">Review Hub</h1>
        <p className="rh-name-modal-sub">Enter your name to get started</p>
        <form onSubmit={handleSubmit} className="rh-name-modal-form">
          <input
            ref={inputRef}
            className="rh-name-modal-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name"
            maxLength={30}
          />
          <button
            type="submit"
            className="rh-name-modal-btn"
            disabled={!valid}
          >
            Join
          </button>
        </form>
      </div>
    </div>
  )
}
