import { create } from 'zustand'

const STORAGE_KEY = 'aycb_review_user'

interface UserState {
  userName: string
  setUserName: (name: string) => void
}

export const useUserStore = create<UserState>((set) => ({
  userName: localStorage.getItem(STORAGE_KEY) || '',
  setUserName: (name: string) => {
    localStorage.setItem(STORAGE_KEY, name)
    set({ userName: name })
  },
}))
