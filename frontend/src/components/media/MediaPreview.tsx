import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { downloadFromUrl } from '../../utils/downloadManager'
import { toggleFavorite, fetchReviewStatus, getStemForMedia, type ReviewStatus } from '../../utils/reviewStatus'
import { type DiskMediaEntry } from './FullscreenMediaBrowser'
import { FullscreenViewer } from './FullscreenViewer'
import styles from './MediaPreview.module.css'

interface PreviewOpts {
  onCapture?: (blob: Blob, timecode: number) => void
  onClear?: () => void
  onImport?: () => void
  onEdit?: (text: string) => void
  initialFrames?: string[]
  mediaId?: string
}

interface MediaPreviewState {
  url: string
  type: 'image' | 'video' | 'text'
  onCapture?: (blob: Blob, timecode: number) => void
  onClear?: () => void
  onImport?: () => void
  onEdit?: (text: string) => void
  initialFrames?: string[]
  mediaId?: string
}

interface MediaPreviewContextType {
  openPreview: (url: string, type: 'image' | 'video' | 'text', opts?: PreviewOpts) => void
  isOpen: boolean
}

const MediaPreviewContext = createContext<MediaPreviewContextType>({ openPreview: () => {}, isOpen: false })

function isJson(text: string): boolean {
  const t = text.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMediaPreview = () => useContext(MediaPreviewContext)

export function MediaPreviewProvider({ children }: { children: React.ReactNode }) {
  const [media, setMedia] = useState<MediaPreviewState | null>(null)
  const [captureMsg, setCaptureMsg] = useState('')
  const [captures, setCaptures] = useState<string[]>([])
  const [editText, setEditText] = useState('')

  // Favorite state (optimistic toggle for FullscreenViewer)
  const [, setIsFavorite] = useState(false)

  // Review status for info panel
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | null>(null)

  // Reset when media changes (render-phase derived state)
  const [prevMediaId, setPrevMediaId] = useState(media?.mediaId)
  if (prevMediaId !== media?.mediaId) {
    setPrevMediaId(media?.mediaId)
    setIsFavorite(false)
    setReviewStatus(null)
  }

  // Keep a stable ref to media for callbacks
  const mediaRef = useRef(media)
  useEffect(() => { mediaRef.current = media }, [media])

  // Fetch review + favorite status when media with mediaId is opened
  useEffect(() => {
    if (!media?.mediaId) return
    let cancelled = false
    fetchReviewStatus(media.mediaId).then(status => {
      if (cancelled) return
      setIsFavorite(status?.favorite ?? false)
      setReviewStatus(status)
    })
    return () => { cancelled = true }
  }, [media?.mediaId])

  const handleFavoriteToggle = useCallback(async () => {
    if (!media?.mediaId) return
    setIsFavorite(prev => !prev)
    const ok = await toggleFavorite(media.mediaId)
    if (!ok) setIsFavorite(prev => !prev)
  }, [media])

  const openPreview = useCallback((url: string, type: 'image' | 'video' | 'text', opts?: PreviewOpts) => {
    setMedia({ url, type, onCapture: opts?.onCapture, onClear: opts?.onClear, onImport: opts?.onImport, onEdit: opts?.onEdit, initialFrames: opts?.initialFrames, mediaId: opts?.mediaId })
    setCaptureMsg('')
    setCaptures(opts?.initialFrames ?? [])
    if (type === 'text') setEditText(isJson(url) ? formatJson(url) : url)
  }, [])

  const close = useCallback(() => {
    setCaptures([])
    setMedia(null)
  }, [])

  // Stable ID for preview entries without mediaId
  const [stableId] = useState(() => `preview-${Date.now()}`)

  // Build a DiskMediaEntry for FullscreenViewer (image/video only) — memoized
  const viewerEntry = useMemo<DiskMediaEntry | null>(() => {
    if (!media || media.type === 'text') return null
    // Resolve IDB mediaId to bridge stem for metadata lookup
    const stem = media.mediaId ? (getStemForMedia(media.mediaId) ?? media.mediaId) : ''
    return {
      id: media.mediaId || stableId,
      filename: media.url.split('/').pop()?.split('?')[0] || 'preview',
      project: '',
      path: '',
      size: 0,
      type: media.type === 'image' ? 'image/png' : 'video/mp4',
      modified: '',
      thumb: null,
      meta: stem ? `/api/bridge/meta/${encodeURIComponent(stem)}` : '',
    }
  }, [media, stableId])

  const viewerEntries = useMemo(() => viewerEntry ? [viewerEntry] : [], [viewerEntry])
  const getViewerSrc = useCallback(() => media?.url, [media?.url])

  // Keyboard handler for text mode only
  useEffect(() => {
    if (!media) return
    if (media.type !== 'text') return

    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation()

      if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); close() }
      if (e.code === 'Space') {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') return
        e.preventDefault(); close()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [media, close])

  return (
    <MediaPreviewContext.Provider value={{ openPreview, isOpen: !!media }}>
      {children}

      {/* Image/Video: delegate to FullscreenViewer */}
      {media && media.type !== 'text' && viewerEntry && (
        <FullscreenViewer
          entries={viewerEntries}
          initialIndex={0}
          onClose={close}
          getSrc={getViewerSrc}
          reviewStatuses={media.mediaId && reviewStatus ? { [viewerEntry.id]: reviewStatus } : undefined}
          onFavoriteToggle={media.mediaId ? () => handleFavoriteToggle() : undefined}
          onDownload={(src, filename) => {
            downloadFromUrl(src, filename)
          }}
          onFindInExplorer={media.mediaId ? () => {
            const stem = getStemForMedia(media.mediaId!)
            if (stem) fetch(`/api/bridge/explore-stem/${encodeURIComponent(stem)}`, { method: 'POST' }).catch(e => console.warn('[bridge] explore-stem failed:', e.message ?? e))
          } : undefined}
          onCapture={media.type === 'video' && media.onCapture ? (blob, timecode) => {
            media.onCapture!(blob, timecode)
          } : undefined}
          initialCaptures={captures}
          onClearCaptures={media.onClear ? () => { media.onClear!(); setCaptures([]) } : undefined}
          onImportCaptures={media.onImport ? () => media.onImport!() : undefined}
        />
      )}

      {/* Text: keep existing overlay */}
      {media && media.type === 'text' && (
        <>
          <div className={styles.overlay} onClick={close} />
          <div className={styles.container}>
            <button className={styles.closeBtn} onClick={close}>{'\u2715'}</button>
            <div className={styles.textContainer}>
              <div className={styles.textToolbar}>
                <span className={styles.textLabel}>{isJson(editText) ? 'JSON' : 'Text'}{media.onEdit ? '' : ' (read-only)'}</span>
                <span className={styles.textStats}>{editText.length.toLocaleString()} chars</span>
                <button className={styles.textBtn} onClick={() => {
                  navigator.clipboard.writeText(editText)
                  setCaptureMsg('Copied!')
                  setTimeout(() => setCaptureMsg(''), 1500)
                }}>Copy</button>
                {media.onEdit && (
                  <button className={styles.textBtn} onClick={() => {
                    media.onEdit!(editText)
                    setCaptureMsg('Saved!')
                    setTimeout(() => setCaptureMsg(''), 1500)
                  }}>Save</button>
                )}
                {captureMsg && <span className={styles.captureMsg}>{captureMsg}</span>}
              </div>
              {media.onEdit ? (
                <textarea
                  className={styles.textContent}
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <pre className={styles.textContent}>{editText}</pre>
              )}
            </div>
            <div className={styles.hint}>Space / Backspace / Esc to close</div>
          </div>
        </>
      )}
    </MediaPreviewContext.Provider>
  )
}
