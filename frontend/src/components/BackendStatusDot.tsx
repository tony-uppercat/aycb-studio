import { useState } from 'react'
import { useCanvasStore } from '../stores/canvasStore'

/** Tiny backend status dot in the top bar with click-to-reconnect. */
export function BackendStatusDot() {
  const status = useCanvasStore(s => s.backendStatus)
  const setBackendStatus = useCanvasStore(s => s.setBackendStatus)
  const [retrying, setRetrying] = useState(false)

  const color = status === 'online' ? '#22c55e' : status === 'offline' ? '#ef4444' : '#f59e0b'
  const label = status === 'online' ? 'Backend online' : status === 'offline' ? 'Backend offline — click to reconnect' : 'Checking backend…'

  async function handleClick() {
    if (status === 'online' || retrying) return
    setRetrying(true)
    for (let i = 0; i < 15; i++) {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
        if (res.ok) { setBackendStatus('online'); setRetrying(false); return }
      } catch { /* offline */ }
      await new Promise(r => setTimeout(r, 1000))
    }
    setRetrying(false)
  }

  return (
    <div
      onClick={handleClick}
      title={label}
      style={{
        width: 8, height: 8, borderRadius: '50%',
        background: retrying ? '#f59e0b' : color,
        cursor: status === 'offline' ? 'pointer' : 'default',
        flexShrink: 0,
        animation: retrying ? 'pulse 1s ease-in-out infinite' : 'none',
      }}
    />
  )
}
