import { useEffect, useState } from 'react'
import styles from './Header.module.css'

export function Header() {
  const [lanIps, setLanIps] = useState<string[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    fetch('/api/health', { signal: controller.signal })
      .then(r => r.json())
      .then(d => {
        const ips: string[] = d.lan_ips ?? (d.local_ip ? [d.local_ip] : [])
        setLanIps(ips)
      })
      .catch(err => { if (err.name !== 'AbortError') console.warn('[Header] health fetch failed:', err) })
      .finally(() => clearTimeout(timeout))
    return () => { clearTimeout(timeout); controller.abort() }
  }, [])

  const lanLines = lanIps.map(ip => `http://${ip}:5100/review`)
  const tooltip = lanLines.length
    ? `Review Hub\nLAN:\n${lanLines.join('\n')}`
    : 'Open Review Hub'

  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>AYCB</h1>
        <p className={styles.subtitle}>Cinematic analysis · Gemini Vision + Embedding</p>
      </div>
      <a
        href="/review"
        className={styles.reviewLink}
        title={tooltip}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span>Review Hub</span>
      </a>
    </header>
  )
}
