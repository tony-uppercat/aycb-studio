import { useState } from 'react'
import { useUserStore } from '../stores/userStore'

interface Props { onClose: () => void; onSave: () => void }

export function UserNameModal({ onClose, onSave }: Props) {
  const { setUserName } = useUserStore()
  const [name, setName] = useState('')

  const handleSave = () => {
    if (!name.trim()) return
    setUserName(name.trim())
    onSave()
  }

  return (
    <div className="rh-modal-overlay" onClick={onClose}>
      <div className="rh-modal" onClick={e => e.stopPropagation()}>
        <h3>Your Name</h3>
        <p>Enter your name to comment and review</p>
        <input className="rh-modal-input" value={name} onChange={e => setName(e.target.value)}
          placeholder="Name" autoFocus onKeyDown={e => { if (e.key === 'Enter') handleSave() }} />
        <div className="rh-modal-actions">
          <button className="rh-modal-cancel" onClick={onClose}>Cancel</button>
          <button className="rh-modal-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
