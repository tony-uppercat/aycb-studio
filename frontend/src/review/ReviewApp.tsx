import { useEffect, useState } from 'react'
import { socket } from './services/socket'
import { useUserStore } from './stores/userStore'
import './styles/review.css'

// Lazy-load pages (they'll be created in later tasks)
// For now, render placeholder divs
function ReviewGallery() { return <div className="rh-placeholder">Gallery — coming in Task 9</div> }
function ReferencePage() { return <div className="rh-placeholder">References — coming in Task 12</div> }

export default function ReviewApp() {
  const { userName, setUserName } = useUserStore()
  const [connected, setConnected] = useState(false)
  const [userCount, setUserCount] = useState(0)

  const path = window.location.pathname

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join_room', { room: 'review', user: userName, device: navigator.userAgent.includes('iPad') ? 'iPad' : 'desktop' })
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('users_update', (users: unknown[]) => setUserCount(users.length))
    socket.connect()

    return () => {
      socket.emit('leave_room', { room: 'review' })
      socket.off('connect')
      socket.off('disconnect')
      socket.off('users_update')
      socket.disconnect()
    }
  }, [userName])

  // Prevent iOS gestures
  useEffect(() => {
    const prevent = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault() }
    document.addEventListener('touchstart', prevent, { passive: false })
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.removeEventListener('touchstart', prevent)
      document.body.style.overscrollBehavior = ''
    }
  }, [])

  const isReferences = path.startsWith('/review/references')

  return (
    <div className="rh-app">
      <nav className="rh-nav">
        <div className="rh-nav-left">
          <a href="/" className="rh-logo">AYCB</a>
          <span className="rh-nav-sep">&middot;</span>
          <a href="/review" className={`rh-nav-link ${!isReferences ? 'rh-nav-active' : ''}`}>Gallery</a>
          <a href="/review/references" className={`rh-nav-link ${isReferences ? 'rh-nav-active' : ''}`}>References</a>
        </div>
        <div className="rh-nav-right">
          <span className={`rh-status-dot ${connected ? 'rh-connected' : 'rh-disconnected'}`} />
          <span className="rh-user-count">{userCount}</span>
          <input
            className="rh-username-input"
            value={userName}
            onChange={e => setUserName(e.target.value)}
            placeholder="Your name"
            maxLength={20}
          />
        </div>
      </nav>
      <main className="rh-main">
        {isReferences ? <ReferencePage /> : <ReviewGallery />}
      </main>
    </div>
  )
}
