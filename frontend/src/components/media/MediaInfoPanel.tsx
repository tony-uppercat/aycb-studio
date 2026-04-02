/**
 * MediaInfoPanel — shared info panel for FullscreenMediaBrowser & FullscreenViewer.
 *
 * Three sections: File, AI Generation, Review.
 * Loads metadata via fetch, detects natural image dimensions,
 * supports prompt copy-to-clipboard and favorite toggle.
 */

import { useCallback, useEffect, useState } from 'react'
import { type DiskMediaEntry } from './FullscreenMediaBrowser'
import { type ReviewStatus, getMediaMeta } from '../../utils/reviewStatus'
import { formatSize, formatDate } from '../../utils/mediaFormatting'
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

/** Format a USD cost: sub-cent as ¢, otherwise as $. */
function fmtCost(n: number): string {
  return n < 0.01 ? `${(n * 100).toFixed(2)}¢` : `$${n.toFixed(4)}`
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
            <DL l="Project" v={entry.project} />
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
              {meta.cost_usd != null && <DL l="Cost" v={fmtCost(meta.cost_usd)} />}
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
          {reviewBadge ? (
            <>
              <div className={`${s.reviewBadge} ${reviewBadge.cls}`}>{reviewBadge.label}</div>
              <dl className={s.dl}>
                <DL l="By" v={rev?.reviewed_by} />
                <DL l="Date" v={rev?.reviewed_at ? new Date(rev.reviewed_at).toLocaleDateString() : null} />
                <DL l="Comments" v={rev && rev.comments_count > 0 ? `${rev.comments_count}` : null} />
                <DL l="Drawings" v={rev && rev.drawings_count > 0 ? `${rev.drawings_count}` : null} />
                {onFavoriteToggle ? (
                  <div className={s.favRow}>
                    <button
                      className={`${s.favButton} ${rev?.favorite ? s.favButtonActive : ''}`}
                      onClick={() => onFavoriteToggle(entry.id)}
                    >
                      {rev?.favorite ? '★ Favorite' : '☆ Add to favorites'}
                    </button>
                  </div>
                ) : (
                  <DL l="Favorite" v={rev?.favorite ? '★ Yes' : null} />
                )}
              </dl>
            </>
          ) : <p className={s.none}>Not reviewed</p>}
        </section>
      </div>
    </div>
  )
}
