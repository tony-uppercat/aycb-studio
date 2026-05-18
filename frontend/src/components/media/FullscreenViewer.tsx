import { useCallback, useEffect, useRef, useState } from 'react'
import { type DiskMediaEntry } from './FullscreenMediaBrowser'
import { MediaInfoPanel } from './MediaInfoPanel'
import { useImageZoom } from './useImageZoom'
import { type ReviewStatus } from '../../utils/reviewStatus'
import styles from './FullscreenViewer.module.css'

// ── Component props ───────────────────────────────────────────────────────────

interface Props {
  entries: DiskMediaEntry[]
  initialIndex: number
  onClose: () => void
  /** Optional: override src URL derivation (e.g., for blob URLs from IndexedDB). */
  getSrc?: (entry: DiskMediaEntry) => string | undefined
  /** Optional: async load full-resolution src (replaces getSrc thumbnail). */
  loadFullSrc?: (entry: DiskMediaEntry) => Promise<string | undefined>
  /** Optional: review statuses keyed by entry.id. */
  reviewStatuses?: Record<string, ReviewStatus | null>
  /** Optional: callback to toggle favorite for an entry. */
  onFavoriteToggle?: (id: string) => void
  /** Optional: download callback for the current media. */
  onDownload?: (src: string, filename: string) => void
  /** Optional: open file location in system explorer. */
  onFindInExplorer?: (entry: DiskMediaEntry) => void
  /** Optional: capture a video frame. */
  onCapture?: (blob: Blob, timecode: number) => void
  /** Initial capture thumbnails (blob URLs). */
  initialCaptures?: string[]
  /** Clear all captures. */
  onClearCaptures?: () => void
  /** Import captures and close viewer. */
  onImportCaptures?: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

/** Derive the full-resolution file URL from a DiskMediaEntry. */
function entryFileUrl(entry: DiskMediaEntry): string {
  return `/api/bridge/media/file/${encodeURIComponent(entry.project)}/${encodeURIComponent(entry.filename)}`
}

export function FullscreenViewer({
  entries, initialIndex, onClose, getSrc, loadFullSrc, reviewStatuses, onFavoriteToggle,
  onDownload, onFindInExplorer, onCapture, initialCaptures, onClearCaptures, onImportCaptures,
}: Props) {
  const [index, setIndex] = useState(initialIndex)
  const [panelOpen, setPanelOpen] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Capture state
  const [captures, setCaptures] = useState<string[]>(initialCaptures ?? [])
  const [captureMsg, setCaptureMsg] = useState('')
  const ownedUrlsRef = useRef<Set<string>>(new Set())

  const entry = entries[index]

  // Reset video state on entry change (React "previous render" pattern)
  const [prevIndex, setPrevIndex] = useState(initialIndex)
  if (prevIndex !== index) {
    setPrevIndex(index)
    setPlaying(true)
    setCurrentTime(0)
    setDuration(0)
  }
  const thumbSrc = entry ? (getSrc ? getSrc(entry) : entryFileUrl(entry)) : undefined
  const isVideo = entry?.type.startsWith('video/') ?? false

  // Async full-resolution loading (replaces thumbnail when ready)
  const [fullSrc, setFullSrc] = useState<string>()
  const fullSrcRef = useRef<string | undefined>(undefined)

  // Clear full src when entry changes (render-phase derived state)
  const [prevEntryId, setPrevEntryId] = useState(entry?.id)
  if (prevEntryId !== entry?.id) {
    setPrevEntryId(entry?.id)
    setFullSrc(undefined)
  }

  useEffect(() => {
    if (!loadFullSrc || !entry) return
    let cancelled = false
    loadFullSrc(entry).then(url => {
      if (cancelled) { if (url) URL.revokeObjectURL(url); return }
      if (fullSrcRef.current) URL.revokeObjectURL(fullSrcRef.current)
      fullSrcRef.current = url ?? undefined
      if (url) setFullSrc(url)
    })
    return () => { cancelled = true }
  }, [entry?.id, loadFullSrc]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ref = fullSrcRef
    return () => { if (ref.current) URL.revokeObjectURL(ref.current) }
  }, [])

  const src = fullSrc ?? thumbSrc

  // Track natural pixel dims + rendered width so the zoom hook can map
  // "100%" to true 1:1 pixel mapping rather than the misleading CSS scale=1
  // (which is fit-to-container after object-fit:contain).
  const imgRef = useRef<HTMLImageElement>(null)
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null)
  const [displayedWidth, setDisplayedWidth] = useState<number | null>(null)

  const measureDisplayed = useCallback(() => {
    const el = imgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // When zoomed/transformed, getBoundingClientRect reflects post-transform
    // width. We want the un-transformed fit width — divide by current scale.
    // But we read state for zoom-aware divide; simpler approach: measure
    // offsetWidth which ignores transforms.
    if (el.offsetWidth > 0) setDisplayedWidth(el.offsetWidth)
  }, [])

  // Wheel zoom + drag pan + double-click reset + keyboard shortcuts (+/-/0/1).
  const imageZoom = useImageZoom({ naturalDims, displayedWidth })

  // Match current zoom to a discrete preset so the scale dropdown stays in sync.
  const scalePreset = (() => {
    if (Math.abs(imageZoom.zoom - 1) < 0.001) return 'fit'
    if (imageZoom.realPercent == null) return ''
    for (const p of [50, 100, 200, 400]) {
      if (Math.abs(imageZoom.realPercent - p) < 2) return String(p)
    }
    return ''
  })()

  // Reset zoom + dims whenever the displayed entry changes.
  useEffect(() => {
    imageZoom.reset()
    setNaturalDims(null)
    setDisplayedWidth(null)
  }, [entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-measure on window resize so fitScale stays accurate.
  useEffect(() => {
    if (isVideo) return
    window.addEventListener('resize', measureDisplayed)
    return () => window.removeEventListener('resize', measureDisplayed)
  }, [isVideo, measureDisplayed])

  const goTo = useCallback((i: number) => {
    setIndex(Math.max(0, Math.min(entries.length - 1, i)))
  }, [entries.length])

  // Cleanup owned blob URLs on unmount
  useEffect(() => {
    const urls = ownedUrlsRef.current
    return () => { urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  function captureFrame() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !onCapture) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) return
      const thumbUrl = URL.createObjectURL(blob)
      ownedUrlsRef.current.add(thumbUrl)
      setCaptures(prev => [...prev, thumbUrl])
      onCapture(blob, video.currentTime)
      setCaptureMsg('Captured!')
      setTimeout(() => setCaptureMsg(''), 1500)
    }, 'image/jpeg', 0.95)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return
      e.stopPropagation()

      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1) }
      if (e.key === 'i' || e.key === 'I') { e.preventDefault(); setPanelOpen(v => !v) }
      if ((e.key === 's' || e.key === 'S') && onDownload && src) { e.preventDefault(); onDownload(src, entry.filename) }
      if ((e.key === 'e' || e.key === 'E') && onFindInExplorer) { e.preventDefault(); onFindInExplorer(entry) }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [onClose, goTo, index, onDownload, onFindInExplorer, src, entry])

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  if (!entry) return null

  return (
    <div className={styles.root}>
      {/* backdrop */}
      <div className={styles.backdrop} onClick={onClose} />

      {/* main viewer container */}
      <div className={styles.container}>

        {/* ── media area ── */}
        <div className={styles.mediaArea}>
          {/* nav: previous */}
          {index > 0 && (
            <button
              className={`${styles.navBtn} ${styles.navBtnLeft}`}
              onClick={() => goTo(index - 1)}
              title="Previous (←)"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
              </svg>
            </button>
          )}

          {/* image */}
          {!isVideo && src && (
            <img
              ref={imgRef}
              src={src}
              alt={entry.filename}
              className={styles.media}
              draggable={false}
              style={imageZoom.style}
              onWheel={imageZoom.handlers.onWheel}
              onMouseDown={imageZoom.handlers.onMouseDown}
              onDoubleClick={imageZoom.handlers.onDoubleClick}
              onLoad={(e) => {
                const el = e.currentTarget
                setNaturalDims({ w: el.naturalWidth, h: el.naturalHeight })
                if (el.offsetWidth > 0) setDisplayedWidth(el.offsetWidth)
              }}
            />
          )}
          {!isVideo && naturalDims && (
            <div
              className={styles.zoomBadge}
              title="Click to snap to 1:1 (or press 1). Press 0 to fit."
              onClick={imageZoom.snapToOneToOne}
              style={{ cursor: 'pointer' }}
            >
              {imageZoom.realPercent != null ? `${imageZoom.realPercent}%` : `${Math.round(imageZoom.zoom * 100)}%`}
              {imageZoom.atOneToOne && ' · 1:1'}
              <span style={{ opacity: 0.55, marginLeft: 8 }}>{naturalDims.w}×{naturalDims.h}</span>
            </div>
          )}

          {/* video */}
          {isVideo && src && (
            <div className={styles.videoWrap}>
              <video
                ref={videoRef}
                src={src}
                className={styles.media}
                autoPlay
                muted
                onClick={togglePlay}
                onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
                onLoadedMetadata={() => videoRef.current && setDuration(videoRef.current.duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              {/* video scrubber */}
              <div
                className={styles.scrubber}
                onMouseDown={(e) => {
                  const seek = (ev: { clientX: number }) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                    const t = pct * (duration || 1)
                    if (videoRef.current) videoRef.current.currentTime = t
                    setCurrentTime(t)
                  }
                  seek(e)
                  const move = (ev: MouseEvent) => seek(ev)
                  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
              >
                <div className={styles.scrubberFill} style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
                <div className={styles.scrubberHead} style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
              </div>
              <div className={styles.videoControls}>
                <button className={styles.playBtn} onClick={togglePlay}>
                  {playing
                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="3" width="5" height="18" /><rect x="14" y="3" width="5" height="18" /></svg>
                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 3l15 9-15 9V3z" /></svg>
                  }
                </button>
                <span className={styles.timeCode}>
                  {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')}
                  {' / '}
                  {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, '0')}
                </span>
              </div>
            </div>
          )}

          {/* placeholder */}
          {!src && (
            <div className={styles.noMedia}>No preview available</div>
          )}

          {/* nav: next */}
          {index < entries.length - 1 && (
            <button
              className={`${styles.navBtn} ${styles.navBtnRight}`}
              onClick={() => goTo(index + 1)}
              title="Next (→)"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          )}

          {/* counter */}
          <div className={styles.counter}>{index + 1} / {entries.length}</div>
        </div>

        {/* ── info panel ── */}
        {panelOpen && (
          <aside className={styles.infoPanel}>
            <MediaInfoPanel
              entry={entry}
              src={src}
              reviewStatus={reviewStatuses?.[entry.id] ?? null}
              onClose={() => setPanelOpen(false)}
              onFavoriteToggle={onFavoriteToggle}
            />
          </aside>
        )}
      </div>

      {/* ── toolbar ── */}
      <div className={styles.toolbar}>
        <button
          className={`${styles.toolBtn} ${panelOpen ? styles.toolBtnActive : ''}`}
          onClick={() => setPanelOpen(v => !v)}
          title="Toggle info panel (I)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          Info
        </button>
        {!isVideo && naturalDims && (
          <select
            className={styles.scaleSelect}
            value={scalePreset}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'fit') imageZoom.reset()
              else if (v) imageZoom.setRealPercent(parseInt(v, 10))
            }}
            title="Zoom level"
          >
            <option value="fit">Fit</option>
            <option value="50">50%</option>
            <option value="100">100% (1:1)</option>
            <option value="200">200%</option>
            <option value="400">400%</option>
            {!scalePreset && <option value="">Custom</option>}
          </select>
        )}
        {onDownload && src && (
          <button className={styles.toolBtn} onClick={() => onDownload(src, entry.filename)} title="Download (S)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Download
          </button>
        )}
        {onFindInExplorer && (
          <button className={styles.toolBtn} onClick={() => onFindInExplorer(entry)} title="Find in Explorer (E)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Explorer
          </button>
        )}
        {isVideo && onCapture && (
          <button className={styles.toolBtn} onClick={captureFrame} title="Capture frame">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/>
            </svg>
            Capture
          </button>
        )}
        {captureMsg && <span className={styles.captureMsg}>{captureMsg}</span>}
        <button className={styles.toolBtn} onClick={onClose} title="Close (Esc)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
          Close
        </button>
      </div>
      {captures.length > 0 && (
        <div className={styles.captureStrip}>
          {captures.map((url, i) => (
            <img key={i} src={url} className={styles.captureThumb} alt={`capture ${i + 1}`} />
          ))}
          <span className={styles.captureCount}>{captures.length}</span>
          {onImportCaptures && (
            <button className={styles.toolBtn} onClick={() => { onImportCaptures(); onClose() }}>Import</button>
          )}
          {onClearCaptures && (
            <button className={styles.toolBtn} onClick={() => { onClearCaptures(); ownedUrlsRef.current.forEach(u => URL.revokeObjectURL(u)); ownedUrlsRef.current.clear(); setCaptures([]) }}>Clear</button>
          )}
        </div>
      )}
    </div>
  )
}
