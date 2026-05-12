/**
 * MediaInfoPanel — shared info panel for FullscreenMediaBrowser & FullscreenViewer.
 *
 * Three sections: File, AI Generation, Review.
 * Loads metadata via fetch, detects natural image dimensions,
 * supports prompt copy-to-clipboard and favorite toggle.
 */

import { useCallback, useEffect, useState } from 'react'
import { type DiskMediaEntry } from './FullscreenMediaBrowser'
import { type ReviewStatus, getMediaMeta, saveMediaMeta } from '../../utils/reviewStatus'
import { formatSize, formatDate } from '../../utils/mediaFormatting'
import { readPngTextChunks } from '../../utils/pngMeta'
import s from './MediaInfoPanel.module.css'

/* ── Types ── */

export interface MediaInfoPanelProps {
  entry: DiskMediaEntry
  src?: string
  reviewStatus: ReviewStatus | null
  onClose: () => void
  onFavoriteToggle?: (id: string) => void
}

interface Meta {
  prompt?: string
  model?: string
  model_name?: string
  aspect_ratio?: string
  image_size?: string
  cost_usd?: number
}

/* ── Helpers ── */

/** Format a USD cost: sub-cent as ¢, otherwise as $. Coerces strings —
 *  legacy meta entries can store cost_usd as a raw PNG chunk string. */
function fmtCost(n: number | string): string {
  const num = typeof n === 'number' ? n : parseFloat(n)
  if (!Number.isFinite(num)) return ''
  return num < 0.01 ? `${(num * 100).toFixed(2)}¢` : `$${num.toFixed(4)}`
}

/** Renders a dt/dd pair; returns null if value is nullish. */
function DL({ l, v }: { l: string; v: string | undefined | null }) {
  return v ? <><dt>{l}</dt><dd>{v}</dd></> : null
}

/* ── Component ── */

export function MediaInfoPanel({ entry, src, reviewStatus: rev, onClose, onFavoriteToggle }: MediaInfoPanelProps) {
  const [metaResult, setMetaResult] = useState<{ id: string; data: Meta | null; loading: boolean }>({ id: '', data: null, loading: false })
  const [dim, setDim] = useState<{ w: number; h: number; src: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset when entry changes (render-phase derived state)
  if (metaResult.id !== entry.id) {
    const local = !entry.meta ? getMediaMeta(entry.id) as Meta | null : null
    setMetaResult({ id: entry.id, data: local, loading: !!entry.meta })
  }
  const meta = metaResult.data
  const loading = metaResult.loading

  // Load metadata via fetch with 5s timeout, fallback to localStorage cache
  useEffect(() => {
    if (!entry.meta) return
    let dead = false
    const currentId = entry.id
    fetch(entry.meta, { signal: AbortSignal.timeout(5000) })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (dead) return
        const data = d && Object.keys(d).length ? d : getMediaMeta(currentId) as Meta | null
        setMetaResult({ id: currentId, data, loading: false })
      })
      .catch(() => {
        if (dead) return
        setMetaResult({ id: currentId, data: getMediaMeta(currentId) as Meta | null, loading: false })
      })
    return () => { dead = true }
  }, [entry.id, entry.meta])

  // Fallback: read PNG tEXt chunks directly from the image blob when no metadata found
  useEffect(() => {
    if (metaResult.loading || metaResult.data || !src) return
    if (entry.type.startsWith('video/')) return
    let dead = false
    fetch(src).then(r => r.blob()).then(blob => {
      if (dead) return
      return readPngTextChunks(blob)
    }).then(chunks => {
      if (dead || !chunks || Object.keys(chunks).length === 0) return
      const data: Meta = {
        prompt: chunks.prompt,
        model: chunks.model,
        model_name: chunks.model_name,
        aspect_ratio: chunks.aspect_ratio,
        image_size: chunks.image_size,
        cost_usd: chunks.cost_usd ? parseFloat(chunks.cost_usd) : undefined,
      }
      if (Object.values(data).some(v => v != null)) {
        // Persist the parsed `data` (cost_usd as number), not the raw PNG
        // chunks where every value is a string. Reading back the raw chunks
        // and calling fmtCost(stringValue) used to throw "n.toFixed is not
        // a function" in the fullscreen browser.
        saveMediaMeta(entry.id, data as Record<string, unknown>)
        setMetaResult(prev => prev.id === entry.id ? { ...prev, data } : prev)
      }
    }).catch(() => { /* not a PNG or fetch failed */ })
    return () => { dead = true }
  }, [metaResult.loading, metaResult.data, src, entry.id, entry.type])

  // Detect natural image dimensions via Image() constructor (skip for videos)
  useEffect(() => {
    if (!src || entry.type.startsWith('video/')) return
    const img = new Image()
    img.onload = () => setDim({ w: img.naturalWidth, h: img.naturalHeight, src })
    img.src = src
  }, [src, entry.type])

  // Derive whether dim is current (reset when src changes)
  const currentDim = dim && dim.src === src ? { w: dim.w, h: dim.h } : null

  // Copy prompt to clipboard with "Copied!" feedback
  const copyPrompt = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [])

  // Review badge styling
  const reviewBadge = rev?.status === 'approved'
    ? { cls: s.reviewBadgeOk, label: '✓ Approved' }
    : rev?.status === 'rejected'
    ? { cls: s.reviewBadgeNo, label: '✗ Rejected' }
    : rev
    ? { cls: s.reviewBadgePend, label: '● Pending' }
    : null

  return (
    <div className={s.panel}>
      {/* Header */}
      <div className={s.header}>
        <h2 className={s.headerLabel}>Details</h2>
        <button className={s.headerClose} onClick={onClose} title="Close panel (I)">✕</button>
      </div>

      <div className={s.body}>
        {/* Section: File */}
        <section className={s.section}>
          <h3 className={s.sectionTitle}>File</h3>
          <dl className={s.dl}>
            <DL l="Name" v={entry.filename} />
            <dt>Project</dt>{entry.project && <dd data-s>{entry.project}</dd>}
            <DL l="Size" v={formatSize(entry.size)} />
            <DL l="Type" v={entry.type} />
            {currentDim && <DL l="Resolution" v={`${currentDim.w} × ${currentDim.h}`} />}
            <DL l="Created" v={formatDate(entry.id) || new Date(entry.modified).toLocaleDateString()} />
          </dl>
        </section>

        {/* Section: AI Generation */}
        <section className={s.section}>
          <h3 className={s.sectionTitle}>AI Generation</h3>
          {loading ? <p className={s.none}>Loading...</p> : meta ? (
            <dl className={s.dl}>
              <DL l="Model" v={meta.model_name ?? meta.model} />
              <DL l="Aspect" v={meta.aspect_ratio} />
              <DL l="Size" v={meta.image_size} />
              {meta.cost_usd != null && <><dt>Cost</dt><dd data-s>{fmtCost(meta.cost_usd)}</dd></>}
              {meta.prompt && (
                <div className={s.promptWrap}>
                  <div className={s.promptLabel}>Prompt</div>
                  <div className={s.prompt} onClick={() => copyPrompt(meta.prompt!)}>{meta.prompt}</div>
                  <button className={s.promptCopy} onClick={() => copyPrompt(meta.prompt!)}>{copied ? 'Copied!' : 'Copy'}</button>
                </div>
              )}
            </dl>
          ) : <p className={s.none}>No metadata</p>}
        </section>

        {/* Section: Review */}
        <section className={s.section}>
          <h3 className={s.sectionTitle}>Review</h3>
          {onFavoriteToggle && (
            <div className={s.favRow}>
              <button
                className={`${s.favButton} ${rev?.favorite ? s.favButtonActive : ''}`}
                onClick={() => onFavoriteToggle(entry.id)}
              >
                {rev?.favorite ? '★ Favorite' : '☆ Add to favorites'}
              </button>
            </div>
          )}
          {reviewBadge ? (
            <>
              <div className={`${s.reviewBadge} ${reviewBadge.cls}`}>{reviewBadge.label}</div>
              <dl className={s.dl}>
                <DL l="By" v={rev?.reviewed_by} />
                <DL l="Date" v={rev?.reviewed_at ? new Date(rev.reviewed_at).toLocaleDateString() : null} />
                <DL l="Comments" v={rev && rev.comments_count > 0 ? `${rev.comments_count}` : null} />
                <DL l="Drawings" v={rev && rev.drawings_count > 0 ? `${rev.drawings_count}` : null} />
                {!onFavoriteToggle && <DL l="Favorite" v={rev?.favorite ? '★ Yes' : null} />}
              </dl>
            </>
          ) : <p className={s.none}>Not reviewed</p>}
        </section>
      </div>
    </div>
  )
}
