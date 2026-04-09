import { useEffect, useRef, useCallback } from 'react'
import { useCanvasStore } from '../stores/canvasStore'

const POLL_INTERVAL = 5000
const HEALTH_URL = '/api/health'

export function useBackendHealth() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasOfflineRef = useRef(false)

  function markOffline() {
    const prev = useCanvasStore.getState().backendStatus
    useCanvasStore.getState().setBackendStatus('offline')
    if (prev !== 'offline') {
      wasOfflineRef.current = true
      useCanvasStore.getState().addLog(`Backend offline — start the backend on port 5101`)
    }
  }

  const check = useCallback(async () => {
    // Only check on localhost
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      useCanvasStore.getState().setBackendStatus('cloud')
      return
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const r = await fetch(HEALTH_URL, { signal: controller.signal })
      clearTimeout(timeout)

      if (r.ok) {
        const prev = useCanvasStore.getState().backendStatus
        useCanvasStore.getState().setBackendStatus('online')
        if (wasOfflineRef.current) {
          wasOfflineRef.current = false
          useCanvasStore.getState().addLog(`Backend reconnected`)
        }
        if (prev === 'unknown') {
          useCanvasStore.getState().addLog(`Backend connected`)
        }
      } else {
        markOffline()
      }
    } catch {
      markOffline()
    }
  }, [])

  useEffect(() => {
    check()
    timerRef.current = setInterval(check, POLL_INTERVAL)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [check])
}
