import { create } from 'zustand'

const STORAGE_KEY = 'aycb_review_user'
const ADMIN_KEY = 'aycb_review_admin'
export const ADMIN_PIN = '1312'

interface UserState {
  user_name: string
  is_admin: boolean
  set_user_name: (name: string) => void
  get_initials: () => string
  unlock_admin: (pin: string) => boolean
  lock_admin: () => void
}

export const useUserStore = create<UserState>((set, get) => ({
  user_name: localStorage.getItem(STORAGE_KEY) || '',
  is_admin: localStorage.getItem(ADMIN_KEY) === '1',
  set_user_name: (name: string) => {
    localStorage.setItem(STORAGE_KEY, name)
    // Clear admin when switching to non-admin user
    if (name.trim().toLowerCase() !== 'admin') {
      localStorage.removeItem(ADMIN_KEY)
      set({ user_name: name, is_admin: false })
    } else {
      set({ user_name: name })
    }
  },
  get_initials: () => {
    const name = get().user_name
    if (!name) return '?'
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  },
  unlock_admin: (pin: string) => {
    if (pin === ADMIN_PIN) {
      localStorage.setItem(ADMIN_KEY, '1')
      set({ is_admin: true })
      return true
    }
    return false
  },
  lock_admin: () => {
    localStorage.removeItem(ADMIN_KEY)
    set({ is_admin: false })
  },
}))
