import { useToastStore } from '../stores/toastStore'

const ICONS: Record<string, string> = {
  success: '\u2713', error: '\u2717', info: 'i', warning: '!',
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.removeToast)
  if (toasts.length === 0) return null
  return (
    <div className="rh-toast-container" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`rh-toast rh-toast-${t.type}`}>
          <span className="rh-toast-icon">{ICONS[t.type]}</span>
          <span className="rh-toast-msg">{t.message}</span>
          <button className="rh-toast-close" onClick={() => remove(t.id)}>&times;</button>
        </div>
      ))}
    </div>
  )
}
