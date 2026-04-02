import { useState } from 'react'
import { useCanvasStore } from '../stores/canvasStore'
import styles from './BackendBanner.module.css'

export function BackendBanner() {
  const status = useCanvasStore(s => s.backendStatus)
  const setBackendStatus = useCanvasStore(s => s.setBackendStatus)
  const [retrying, setRetrying] = useState(false)
  const [countdown, setCountdown] = useState(0)

  if (status !== 'offline') return null

  async function handleReconnect() {
    setRetrying(true)
    // Poll every second for up to 30s
    for (let i = 30; i > 0; i--) {
      setCountdown(i)
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
        if (res.ok) {
          setBackendStatus('online')
          setRetrying(false)
          return
        }
      } catch { /* still offline */ }
      await new Promise(r => setTimeout(r, 1000))
    }
    setRetrying(false)
    setCountdown(0)
  }

  return (
    <div className={styles.banner}>
      <span className={styles.dot} />
      <span className={styles.text}>Backend offline</span>
      <code className={styles.hint}>python -m src.cli ui-react</code>
      <button
        className={styles.retryBtn}
        onClick={handleReconnect}
        disabled={retrying}
        title="Poll /api/health until backend responds"
      >
        {retrying ? `Reconnecting… ${countdown}s` : 'Reconnect'}
      </button>
    </div>
  )
}
