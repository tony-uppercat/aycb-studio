import { lazy, Suspense } from 'react'
import { ToastProvider } from './components/ui/Toast'
import { SettingsProvider } from './components/SettingsContext'
import { FlowCanvas } from './components/canvas/FlowCanvas'
import { MediaPreviewProvider } from './components/media/MediaPreview'
import { ErrorBoundary } from './components/ui/ErrorBoundary'

const ReviewApp = lazy(() => import('./review/ReviewApp'))

export default function App() {
  const isReview = window.location.pathname.startsWith('/review')
  if (isReview) {
    return (
      <Suspense fallback={<div style={{ background: '#0a0a0b', color: '#a1a1aa', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading Review Hub...</div>}>
        <ReviewApp />
      </Suspense>
    )
  }

  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--surface-0, #141414)',
          color: 'var(--text-primary, #e8e8e8)',
          gap: 20,
          padding: 32,
          fontFamily: 'var(--font-body, sans-serif)',
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Something went wrong</h2>
          <p style={{
            margin: 0,
            fontSize: 13,
            color: 'var(--text-secondary, #a0a0a0)',
            fontFamily: 'var(--font-mono, monospace)',
            background: 'var(--surface-2, #1e1e1e)',
            padding: '10px 16px',
            borderRadius: 'var(--radius-md, 8px)',
            border: '1px solid #3a3a3a',
            maxWidth: 560,
            textAlign: 'center',
            wordBreak: 'break-word',
          }}>
            {error.message || 'An unexpected error occurred.'}
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 20px',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 'var(--radius-md, 8px)',
                border: 'none',
                background: '#ef4444',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Reload App
            </button>
            <button
              onClick={reset}
              style={{
                padding: '8px 20px',
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid #3a3a3a',
                background: 'var(--surface-2, #1e1e1e)',
                color: 'var(--text-primary, #e8e8e8)',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    >
      <SettingsProvider>
        <ToastProvider>
          <MediaPreviewProvider>
            <FlowCanvas />
          </MediaPreviewProvider>
        </ToastProvider>
      </SettingsProvider>
    </ErrorBoundary>
  )
}
