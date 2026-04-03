import { create } from 'zustand'

interface SocketState {
  mediaVersion: number
  bumpMediaVersion: () => void
}

export const useSocketStore = create<SocketState>((set) => ({
  mediaVersion: 0,
  bumpMediaVersion: () => set(s => ({ mediaVersion: s.mediaVersion + 1 })),
}))
