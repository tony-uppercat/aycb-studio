import { io } from 'socket.io-client'

// Use relative path — Vite proxy forwards /socket.io to backend (ws: true).
// This works from localhost AND LAN (no cross-port / CORS issues).
export const socket = io({
  autoConnect: false,
  transports: ['websocket', 'polling'],
})

/* eslint-disable @typescript-eslint/no-explicit-any */
export const onEvent = (event: string, cb: (...args: any[]) => void) => socket.on(event, cb)
export const offEvent = (event: string, cb: (...args: any[]) => void) => socket.off(event, cb)
export const emitEvent = (event: string, data?: unknown) => socket.emit(event, data)
