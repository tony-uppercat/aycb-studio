import { useEffect, useRef, useState } from 'react'
import { useUserStore } from '../stores/userStore'

interface NameModalProps {
  initial_name: string
  on_confirm: (name: string) => void
}

export function NameModal({ initial_name, on_confirm }: NameModalProps) {
  const [name, setName] = useState(initial_name)
  const [ask_pin, setAskPin] = useState(false)
  const [pin, setPin] = useState('')
  const [pin_error, setPinError] = useState(false)
  const { unlock_admin } = useUserStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const pinRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    if (ask_pin) pinRef.current?.focus()
  }, [ask_pin])

  const valid = name.trim().length >= 2

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return
    if (name.trim().toLowerCase() === 'admin') {
      setAskPin(true)
      return
    }
    on_confirm(name.trim())
  }

  const handlePin = (e: React.FormEvent) => {
    e.preventDefault()
    if (unlock_admin(pin)) {
      on_confirm(name.trim())
    } else {
      setPinError(true)
      setPin('')
    }
  }

  if (ask_pin) {
    return (
      <div className="rh-name-modal-backdrop">
        <div className="rh-name-modal-card">
          <h1 className="rh-name-modal-brand">Admin Access</h1>
          <p className="rh-name-modal-sub">Enter pin to continue</p>
          <form onSubmit={handlePin} className="rh-name-modal-form">
            <input
              ref={pinRef}
              className={`rh-name-modal-input${pin_error ? ' rh-name-modal-input--error' : ''}`}
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setPinError(false) }}
              placeholder="Pin"
              maxLength={10}
            />
            <button type="submit" className="rh-name-modal-btn" disabled={!pin.trim()}>
              Unlock
            </button>
            <button type="button" className="rh-name-modal-btn-secondary" onClick={() => { setAskPin(false); setPinError(false); setPin('') }}>
              Back
            </button>
          </form>
        </div>
      </div>
    )
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
