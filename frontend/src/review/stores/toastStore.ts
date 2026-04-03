import { create } from 'zustand'

interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration: number
}

interface ToastState {
  toasts: Toast[]
  addToast: (type: Toast['type'], message: string, duration?: number) => void
  removeToast: (id: string) => void
}

const DURATIONS: Record<Toast['type'], number> = {
  success: 3000, info: 4000, warning: 5000, error: 5000,
}

let _id = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (type, message, duration) => {
    const id = String(++_id)
    const ms = duration ?? DURATIONS[type]
    set((s) => ({ toasts: [...s.toasts, { id, type, message, duration: ms }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (msg: string) => useToastStore.getState().addToast('success', msg),
  error: (msg: string) => useToastStore.getState().addToast('error', msg),
  info: (msg: string) => useToastStore.getState().addToast('info', msg),
  warning: (msg: string) => useToastStore.getState().addToast('warning', msg),
}
