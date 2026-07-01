import { useEffect, useRef, useState } from 'react'
import { ExpandableText } from '../_shared/ExpandableText'
import styles from '../_shared/Node.module.css'

export const MAX_LLM_HISTORY = 20

export interface LLMHistoryEntry {
  prompt: string
  output: string
  model: string
  ts: number
}

/** Append an entry to a (possibly undefined/foreign) history list, capped at MAX. */
export function pushLLMHistory(prev: unknown, entry: LLMHistoryEntry): LLMHistoryEntry[] {
  const arr = Array.isArray(prev) ? (prev as LLMHistoryEntry[]) : []
  return [...arr, entry].slice(-MAX_LLM_HISTORY)
}

/** Coerce a foreign data field into a typed history list (empty if absent/malformed). */
export function readLLMHistory(raw: unknown): LLMHistoryEntry[] {
  return Array.isArray(raw) ? (raw as LLMHistoryEntry[]) : []
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * Collapsible, read-only viewer of past LLM prompts + responses.
 * Each run appends an entry (see pushLLMHistory); this lets the user browse
 * and re-read what was sent and what came back. Does not touch the live boxes.
 */
export function LLMHistory({ entries }: { entries: LLMHistoryEntry[] }) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(entries.length - 1)
  const prevLen = useRef(entries.length)

  // Auto-advance to newest when a fresh entry arrives.
  useEffect(() => {
    if (entries.length !== prevLen.current) {
      setIndex(entries.length - 1)
      prevLen.current = entries.length
    }
  }, [entries.length])

  if (entries.length === 0) return null
  const i = Math.min(Math.max(index, 0), entries.length - 1)
  const entry = entries[i]

  return (
    <div className={styles.nodeContent} style={{ gap: 2 }}>
      <div className={styles.historyBar}>
        <button
          className={styles.historyGridBtn}
          onClick={() => setOpen(o => !o)}
          title={open ? 'Hide history' : 'Show history'}
          style={{ marginLeft: 0, width: 'auto', padding: '0 6px', fontSize: 9, letterSpacing: '0.4px' }}
        >
          History
        </button>
        <button
          className={styles.historyArrow}
          disabled={i <= 0}
          onClick={() => { setOpen(true); setIndex(i - 1) }}
          title="Older"
        >&#8249;</button>
        <span className={styles.historyCount}>{i + 1}/{entries.length}</span>
        <button
          className={styles.historyArrow}
          disabled={i >= entries.length - 1}
          onClick={() => { setOpen(true); setIndex(i + 1) }}
          title="Newer"
        >&#8250;</button>
      </div>
      {open && (
        <>
          <div style={{ fontSize: 9, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            {entry.model} · {relTime(entry.ts)}
          </div>
          <span className={styles.label}>Prompt</span>
          <ExpandableText value={entry.prompt} rows={2} placeholder="(empty prompt)" />
          <span className={styles.label}>Response</span>
          <ExpandableText value={entry.output} rows={4} placeholder="(empty response)" />
        </>
      )}
    </div>
  )
}
