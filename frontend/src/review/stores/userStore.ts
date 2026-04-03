import { create } from 'zustand'

const STORAGE_KEY = 'aycb_review_user'

interface UserState {
  userName: string
  setUserName: (name: string) => void
  getInitials: () => string
  isAdmin: () => boolean
}

export const useUserStore = create<UserState>((set, get) => ({
  userName: localStorage.getItem(STORAGE_KEY) || '',
  setUserName: (name: string) => {
    localStorage.setItem(STORAGE_KEY, name)
    set({ userName: name })
  },
  getInitials: () => {
    const name = get().userName
    if (!name) return '?'
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  },
  isAdmin: () => get().userName.trim().toLowerCase() === 'admin',
}))
