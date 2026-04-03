import { useCallback, useEffect, useRef, useState } from 'react'
import { rhApi } from '../services/api'

interface ConsolePanelProps {
  is_open: boolean
  on_close: () => void
}

type ConsoleTab = 'server' | 'network' | 'errors'

interface NetworkEntry {
  id: number
  method: string
  url: string
  status: number
  duration: number
  ts: string
}

interface ErrorEntry {
  id: number
  message: string
  source: string
  ts: string
}

interface FeedbackItem {
  id: number
  message: string
  category: string
  author: string
  resolved: boolean
  created_at?: string
}

let _entry_id = 0

export function ConsolePanel({ is_open, on_close }: ConsolePanelProps) {
  const [tab, setTab] = useState<ConsoleTab>('server')
  const [server_logs, setServerLogs] = useState<string[]>([])
  const [network_logs, setNetworkLogs] = useState<NetworkEntry[]>([])
  const [error_logs, setErrorLogs] = useState<ErrorEntry[]>([])
  const [feedback_items, setFeedbackItems] = useState<FeedbackItem[]>([])
  const [fb_input, setFbInput] = useState('')
  const [fb_category, setFbCategory] = useState('bug')
  const poll_ref = useRef<ReturnType<typeof setInterval> | null>(null)
  const orig_fetch = useRef<typeof window.fetch | null>(null)

  // Server log polling
  useEffect(() => {
    if (!is_open || tab !== 'server') return
    const load = () => rhApi.getLogs().then(r => setServerLogs(r.logs)).catch(() => {})
    load()
    poll_ref.current = setInterval(load, 3000)
    return () => { if (poll_ref.current) clearInterval(poll_ref.current) }
  }, [is_open, tab])

  // Feedback load
  useEffect(() => {
    if (!is_open) return
    rhApi.listFeedback().then(r => setFeedbackItems(r.items as FeedbackItem[])).catch(() => {})
  }, [is_open])

  // Network fetch patch
  useEffect(() => {
    orig_fetch.current = window.fetch
    const patched: typeof fetch = async (input, init) => {
      const start = Date.now()
      const method = (init?.method || 'GET').toUpperCase()
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      try {
        const res = await orig_fetch.current!(input, init)
        const entry: NetworkEntry = { id: ++_entry_id, method, url, status: res.status, duration: Date.now() - start, ts: new Date().toLocaleTimeString() }
        setNetworkLogs(prev => [entry, ...prev].slice(0, 200))
        return res
      } catch (err) {
        const entry: NetworkEntry = { id: ++_entry_id, method, url, status: 0, duration: Date.now() - start, ts: new Date().toLocaleTimeString() }
        setNetworkLogs(prev => [entry, ...prev].slice(0, 200))
        throw err
      }
    }
    window.fetch = patched
    return () => { if (orig_fetch.current) window.fetch = orig_fetch.current }
  }, [])

  // Error listeners
  useEffect(() => {
    const on_error = (e: ErrorEvent) => {
      const entry: ErrorEntry = { id: ++_entry_id, message: e.message, source: e.filename || 'unknown', ts: new Date().toLocaleTimeString() }
      setErrorLogs(prev => [entry, ...prev].slice(0, 200))
    }
    const on_unhandled = (e: PromiseRejectionEvent) => {
      const entry: ErrorEntry = { id: ++_entry_id, message: String(e.reason), source: 'promise', ts: new Date().toLocaleTimeString() }
      setErrorLogs(prev => [entry, ...prev].slice(0, 200))
    }
    window.addEventListener('error', on_error)
    window.addEventListener('unhandledrejection', on_unhandled)
    return () => {
      window.removeEventListener('error', on_error)
      window.removeEventListener('unhandledrejection', on_unhandled)
    }
  }, [])

  const submit_feedback = useCallback(async () => {
    const msg = fb_input.trim()
    if (!msg) return
    try {
      await rhApi.addFeedback({ message: msg, category: fb_category })
      setFbInput('')
      const r = await rhApi.listFeedback()
      setFeedbackItems(r.items as FeedbackItem[])
    } catch { /* ignore */ }
  }, [fb_input, fb_category])

  const resolve_feedback = async (id: number) => {
    try {
      await rhApi.resolveFeedback(id)
      setFeedbackItems(prev => prev.map(f => f.id === id ? { ...f, resolved: true } : f))
    } catch { /* ignore */ }
  }

  if (!is_open) return null

  const FB_CATEGORIES = [
    { id: 'bug', label: 'Bug' },
    { id: 'ux', label: 'UX' },
    { id: 'idea', label: 'Idea' },
    { id: 'prompt', label: 'Prompt' },
  ]

  return (
    <div className="rh-console">
      <div className="rh-console-header">
        <div className="rh-console-tabs">
          {(['server', 'network', 'errors'] as ConsoleTab[]).map(t => (
            <button key={t} className={`rh-tab${tab === t ? ' rh-tab-active' : ''}`} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === 'errors' && error_logs.length > 0 && <span className="rh-console-badge">{error_logs.length}</span>}
            </button>
          ))}
        </div>
        <button className="rh-console-close" onClick={on_close} title="Close">x</button>
      </div>
      <div className="rh-console-body">
        <div className="rh-console-left">
          {tab === 'server' && (
            <div className="rh-console-log">
              {server_logs.length === 0
                ? <div className="rh-console-empty">No logs</div>
                : server_logs.map((line, i) => <div key={i} className="rh-console-line">{line}</div>)
              }
            </div>
          )}
          {tab === 'network' && (
            <div className="rh-console-log">
              {network_logs.length === 0
                ? <div className="rh-console-empty">No requests captured</div>
                : network_logs.map(e => (
                  <div key={e.id} className="rh-console-net-row">
                    <span className={`rh-console-method rh-console-method--${e.method.toLowerCase()}`}>{e.method}</span>
                    <span className="rh-console-url">{e.url}</span>
                    <span className={`rh-console-status${e.status >= 400 ? ' rh-console-status--err' : ''}`}>{e.status || 'ERR'}</span>
                    <span className="rh-console-dur">{e.duration}ms</span>
                    <span className="rh-console-ts">{e.ts}</span>
                  </div>
                ))
              }
            </div>
          )}
          {tab === 'errors' && (
            <div className="rh-console-log">
              {error_logs.length === 0
                ? <div className="rh-console-empty">No errors</div>
                : error_logs.map(e => (
                  <div key={e.id} className="rh-console-error-row">
                    <span className="rh-console-ts">{e.ts}</span>
                    <span className="rh-console-error-msg">{e.message}</span>
                    <span className="rh-console-error-src">{e.source}</span>
                  </div>
                ))
              }
            </div>
          )}
        </div>
        <div className="rh-console-right">
          <div className="rh-feedback-header">Feedback</div>
          <div className="rh-feedback-list">
            {feedback_items.length === 0
              ? <div className="rh-console-empty">No feedback yet</div>
              : feedback_items.map(f => (
                <div key={f.id} className={`rh-feedback-item${f.resolved ? ' rh-feedback-item--resolved' : ''}`}>
                  <span className={`rh-feedback-tag rh-feedback-tag--${f.category}`}>{f.category}</span>
                  <span className="rh-feedback-msg">{f.message}</span>
                  {!f.resolved && (
                    <button className="rh-feedback-resolve" onClick={() => resolve_feedback(f.id)} title="Mark resolved">ok</button>
                  )}
                </div>
              ))
            }
          </div>
          <div className="rh-feedback-form">
            <div className="rh-feedback-cats">
              {FB_CATEGORIES.map(c => (
                <button key={c.id} className={`rh-feedback-cat${fb_category === c.id ? ' rh-feedback-cat--active' : ''}`} onClick={() => setFbCategory(c.id)}>{c.label}</button>
              ))}
            </div>
            <div className="rh-feedback-input-row">
              <input
                className="rh-feedback-input"
                value={fb_input}
                onChange={e => setFbInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit_feedback() }}
                placeholder="Add feedback..."
              />
              <button className="rh-feedback-send" onClick={submit_feedback} disabled={!fb_input.trim()}>Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
