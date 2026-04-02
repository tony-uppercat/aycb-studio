import { createContext, useCallback, useContext, useRef, useState } from 'react'
import styles from './Toast.module.css'

interface ToastCtx { show(msg: string): void }
const Ctx = createContext<ToastCtx>({ show: () => {} })
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState('')
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback((m: string) => {
    clearTimeout(timerRef.current)
    setMsg(m)
    setVisible(true)
    timerRef.current = setTimeout(() => setVisible(false), 1600)
  }, [])

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {visible && <div className={styles.toast}>{msg}</div>}
    </Ctx.Provider>
  )
}
