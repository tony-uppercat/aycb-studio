import styles from './Header.module.css'

export function Header() {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>AYCB</h1>
        <p className={styles.subtitle}>Cinematic analysis · Gemini Vision + Embedding</p>
      </div>
      <a
        href="/review"
        className={styles.reviewLink}
        title="Open Review Hub"
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
