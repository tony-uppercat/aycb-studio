import { useEffect, useRef, useState } from 'react'
import { socket } from '../services/socket'
import { useSocketStore } from '../stores/socketStore'
import type { ConnectedUser } from '../stores/socketStore'

export function ConnectionStatus() {
  const { users, latency, reconnecting } = useSocketStore()
  const [dropdown_open, setDropdownOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Ping every 5s
  useEffect(() => {
    const { setLatency } = useSocketStore.getState()

    const send_ping = () => {
      socket.volatile.emit('ping_check', Date.now())
    }

    const handle_pong = (sent_at: number) => {
      setLatency(Date.now() - sent_at)
    }

    socket.on('pong_check', handle_pong)
    const interval = setInterval(send_ping, 5000)
    send_ping()

    return () => {
      socket.off('pong_check', handle_pong)
      clearInterval(interval)
    }
  }, [])

  // Click-outside to close dropdown
  useEffect(() => {
    if (!dropdown_open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdown_open])

  const dot_class = reconnecting
    ? 'rh-conn-dot rh-conn-dot--warn'
    : socket.connected
      ? 'rh-conn-dot rh-conn-dot--ok'
      : 'rh-conn-dot rh-conn-dot--err'

  const latency_class = latency < 100
    ? 'rh-conn-latency rh-conn-latency--ok'
    : latency < 300
      ? 'rh-conn-latency rh-conn-latency--warn'
      : 'rh-conn-latency rh-conn-latency--err'

  return (
    <div className="rh-conn" ref={ref}>
      <span className={dot_class} title={reconnecting ? 'Reconnecting...' : socket.connected ? 'Connected' : 'Disconnected'} />
      {latency > 0 && (
        <span className={latency_class}>{latency}ms</span>
      )}
      <button
        className="rh-conn-users-btn"
        onClick={() => setDropdownOpen(v => !v)}
        title="Online users"
      >
        {users.length} online
      </button>
      {dropdown_open && (
        <div className="rh-conn-dropdown">
          {users.length === 0 ? (
            <div className="rh-conn-dropdown-empty">No users online</div>
          ) : (
            users.map((u: ConnectedUser) => (
              <UserRow key={u.id} user={u} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function get_initials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function UserRow({ user }: { user: ConnectedUser }) {
  return (
    <div className="rh-conn-user-row">
      <span className="rh-conn-user-avatar">{get_initials(user.user)}</span>
      <span className="rh-conn-user-name">{user.user}</span>
      <span className="rh-conn-user-device">{user.device}</span>
    </div>
  )
}
