import { io } from 'socket.io-client'

// Connect directly to backend port for real WebSocket (no Vite proxy latency).
// In dev: same hostname, port 5101. Vite proxy adds latency + breaks WS upgrade.
const backendUrl = `${window.location.protocol}//${window.location.hostname}:5101`

export const socket = io(backendUrl, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
})

/* eslint-disable @typescript-eslint/no-explicit-any */
export const onEvent = (event: string, cb: (...args: any[]) => void) => socket.on(event, cb)
export const offEvent = (event: string, cb: (...args: any[]) => void) => socket.off(event, cb)
export const emitEvent = (event: string, data?: unknown) => socket.emit(event, data)
