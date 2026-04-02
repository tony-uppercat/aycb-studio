import { Component, type ReactNode, type ErrorInfo } from 'react'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state

    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset)
      }

      return (
        <div className={styles.container}>
          <div className={styles.icon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p className={styles.message}>{error.message || 'An unexpected error occurred.'}</p>
          <div className={styles.actions}>
            <button className={styles.btnPrimary} onClick={this.reset}>
              Try Again
            </button>
            <button
              className={styles.btnSecondary}
              onClick={() => {
                navigator.clipboard.writeText(
                  `${error.message}\n\n${error.stack ?? ''}`
                ).catch(() => undefined)
              }}
            >
              Copy Error
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
