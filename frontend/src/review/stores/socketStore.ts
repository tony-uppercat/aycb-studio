import { create } from 'zustand'

export interface ConnectedUser {
  id: string
  user: string
  device: string
}

interface SocketState {
  mediaVersion: number
  users: ConnectedUser[]
  latency: number
  reconnecting: boolean
  bumpMediaVersion: () => void
  setUsers: (users: ConnectedUser[]) => void
  setLatency: (ms: number) => void
  setReconnecting: (v: boolean) => void
}

export const useSocketStore = create<SocketState>((set) => ({
  mediaVersion: 0,
  users: [],
  latency: 0,
  reconnecting: false,
  bumpMediaVersion: () => set(s => ({ mediaVersion: s.mediaVersion + 1 })),
  setUsers: (users) => set({ users }),
  setLatency: (ms) => set({ latency: ms }),
  setReconnecting: (v) => set({ reconnecting: v }),
}))
