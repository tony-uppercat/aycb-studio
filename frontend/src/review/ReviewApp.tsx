import { useEffect, useState, useCallback } from 'react'
import { socket } from './services/socket'
import { useUserStore } from './stores/userStore'
import { useSocketStore } from './stores/socketStore'
import { toast } from './stores/toastStore'
import { ReviewGallery } from './pages/ReviewGallery'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ConsolePanel } from './components/ConsolePanel'
import { NameModal } from './components/NameModal'
import { ToastContainer } from './components/Toast'
import './styles/review.css'

export default function ReviewApp() {
  const { user_name, set_user_name, get_initials, is_admin } = useUserStore()
  const [console_open, setConsoleOpen] = useState(false)
  const [show_name_modal, setShowNameModal] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const handleRestart = useCallback(async () => {
    setRestarting(true)
    // Get current startup time to detect actual restart
    let oldStart = 0
    try {
      const h = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
      const d = await h.json()
      oldStart = d.started_at ?? 0
    } catch { /* offline */ }
    try { await fetch('/api/restart', { method: 'POST' }) } catch { /* backend dies */ }
    const t0 = Date.now()
    const poll = setInterval(async () => {
      if (Date.now() - t0 > 15_000) {
        clearInterval(poll); setRestarting(false)
        toast.error('Restart failed — backend may not be running with --reload')
        return
      }
      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
        if (!r.ok) return
        const d = await r.json()
        if (d.started_at && d.started_at !== oldStart) {
          clearInterval(poll); setRestarting(false)
          toast.success('Backend restarted')
          window.location.reload()
        }
      } catch { /* still down */ }
    }, 1500)
  }, [])

  // Show name modal on first visit or missing name
  useEffect(() => {
    if (!user_name || user_name.trim().length < 2) {
      setShowNameModal(true)
    }
  }, [])

  // Socket connection + events
  useEffect(() => {
    const { setUsers, setReconnecting, bumpMediaVersion } = useSocketStore.getState()

    const on_connect = () => {
      setReconnecting(false)
      socket.emit('join_room', {
        room: 'review',
        user: user_name,
        device: navigator.userAgent.includes('iPad') ? 'iPad' : 'desktop',
      })
    }
    const on_disconnect = () => setReconnecting(false)
    const on_reconnect_attempt = () => setReconnecting(true)
    const on_users_update = (users: unknown[]) => setUsers(users as Parameters<typeof setUsers>[0])
    const on_media_update = () => bumpMediaVersion()

    const on_comment_new = (data: { author?: string }) => {
      toast.info(`New comment from ${data?.author ?? 'someone'}`)
    }
    const on_favorite_toggle = (data: { user?: string }) => {
      toast.info(`${data?.user ?? 'Someone'} toggled a favorite`)
    }
    const on_drawing_save = (data: { author?: string }) => {
      toast.info(`${data?.author ?? 'Someone'} saved a drawing`)
    }
    const on_feedback_new = (data: { author?: string }) => {
      toast.info(`New feedback from ${data?.author ?? 'someone'}`)
    }

    socket.on('connect', on_connect)
    socket.on('disconnect', on_disconnect)
    socket.io.on('reconnect_attempt', on_reconnect_attempt)
    socket.on('users_update', on_users_update)
    socket.on('media_update', on_media_update)
    socket.on('comment_new', on_comment_new)
    socket.on('favorite_toggle', on_favorite_toggle)
    socket.on('drawing_save', on_drawing_save)
    socket.on('feedback_new', on_feedback_new)

    socket.connect()

    return () => {
      socket.emit('leave_room', { room: 'review' })
      socket.off('connect', on_connect)
      socket.off('disconnect', on_disconnect)
      socket.io.off('reconnect_attempt', on_reconnect_attempt)
      socket.off('users_update', on_users_update)
      socket.off('media_update', on_media_update)
      socket.off('comment_new', on_comment_new)
      socket.off('favorite_toggle', on_favorite_toggle)
      socket.off('drawing_save', on_drawing_save)
      socket.off('feedback_new', on_feedback_new)
      socket.disconnect()
    }
  }, [user_name])

  // Backtick shortcut to toggle console
  useEffect(() => {
    const on_key = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          setConsoleOpen(v => !v)
        }
      }
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [])

  // iOS gesture prevention
  useEffect(() => {
    const prevent = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault() }
    document.addEventListener('touchstart', prevent, { passive: false })
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.removeEventListener('touchstart', prevent)
      document.body.style.overscrollBehavior = ''
    }
  }, [])

  const handle_confirm_name = (name: string) => {
    set_user_name(name)
    setShowNameModal(false)
  }

  const toggle_console = () => setConsoleOpen(v => !v)

  const initials = get_initials()

  return (
    <div className="rh-app">
      <nav className="rh-nav">
        <div className="rh-nav-left">
          <a href="/" className="rh-brand-icon">R</a>
          <span className="rh-brand-title">Review Hub</span>
        </div>
        <div className="rh-nav-right">
          {is_admin && (
            <button
              className="rh-console-toggle"
              onClick={handleRestart}
              disabled={restarting}
              title="Restart backend (admin)"
            >
              {restarting ? 'Restarting...' : 'Restart'}
            </button>
          )}
          <button
            className={`rh-console-toggle${console_open ? ' rh-console-toggle--active' : ''}`}
            onClick={toggle_console}
            title="Toggle console (`)"
          >
            Console
          </button>
          <ConnectionStatus />
          <button
            className="rh-current-user"
            onClick={() => setShowNameModal(true)}
            title="Change name"
          >
            <span className="rh-user-avatar">{initials}</span>
            <span className="rh-user-name">{user_name || 'Guest'}</span>
          </button>
        </div>
      </nav>
      <main className="rh-main">
        <ReviewGallery />
      </main>
      <ConsolePanel is_open={console_open} on_close={toggle_console} />
      <ToastContainer />
      {show_name_modal && (
        <NameModal initial_name={user_name} on_confirm={handle_confirm_name} />
      )}
    </div>
  )
}
