import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { downloadFromUrl } from '../../utils/downloadManager'
import { fetchReviewStatus, getStemForMedia, type ReviewStatus } from '../../utils/reviewStatus'
import { useFavoriteToggle } from '../../hooks/useFavoriteToggle'
import { loadMedia } from '../../mediaStore'
import { type DiskMediaEntry } from './FullscreenMediaBrowser'
import { FullscreenViewer } from './FullscreenViewer'
import styles from './MediaPreview.module.css'

interface GalleryOpts {
  urls?: string[]      // optional: pre-loaded blob URLs (from history panel); loaded on demand if absent
  mediaIds?: string[]
  index: number
}

interface PreviewOpts {
  onCapture?: (blob: Blob, timecode: number) => void
  onClear?: () => void
  onImport?: () => void
  onEdit?: (text: string) => void
  initialFrames?: string[]
  mediaId?: string
  gallery?: GalleryOpts
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
  gallery?: GalleryOpts
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

  // Review statuses keyed by mediaId — covers single entry and all gallery entries
  const [reviewStatusesMap, setReviewStatusesMap] = useState<Record<string, ReviewStatus | null>>({})
  const handleFavoriteToggle = useFavoriteToggle(setReviewStatusesMap)

  // Keep a stable ref to media for callbacks
  const mediaRef = useRef(media)
  useEffect(() => { mediaRef.current = media }, [media])

  // Fetch review statuses for current entry and all gallery entries
  useEffect(() => {
    setReviewStatusesMap({})
    const ids: string[] = media?.gallery?.mediaIds?.filter(Boolean) as string[] ?? []
    if (media?.mediaId && !ids.includes(media.mediaId)) ids.push(media.mediaId)
    if (ids.length === 0) return
    let cancelled = false
    for (const id of ids) {
      fetchReviewStatus(id).then(status => {
        if (!cancelled) setReviewStatusesMap(prev => ({ ...prev, [id]: status }))
      })
    }
    return () => { cancelled = true }
  }, [media])

  const openPreview = useCallback((url: string, type: 'image' | 'video' | 'text', opts?: PreviewOpts) => {
    setMedia({ url, type, onCapture: opts?.onCapture, onClear: opts?.onClear, onImport: opts?.onImport, onEdit: opts?.onEdit, initialFrames: opts?.initialFrames, mediaId: opts?.mediaId, gallery: opts?.gallery })
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

  // Build DiskMediaEntry array for FullscreenViewer — gallery mode or single
  const viewerEntries = useMemo<DiskMediaEntry[]>(() => {
    if (!media || media.type === 'text') return []
    if (media.gallery) {
      const urls = media.gallery.urls ?? []
      const mediaIds = media.gallery.mediaIds ?? []
      const count = Math.max(urls.length, mediaIds.length)
      return Array.from({ length: count }, (_, i) => {
        const mid = mediaIds[i]
        const stem = mid ? (getStemForMedia(mid) ?? mid) : ''
        return {
          id: mid || `gallery-${i}`,
          filename: urls[i]?.split('/').pop()?.split('?')[0] || `image-${i + 1}.png`,
          project: '', path: '', size: 0,
          type: (media.type === 'image' ? 'image/png' : 'video/mp4') as string,
          modified: '', thumb: null,
          meta: stem ? `/api/bridge/meta/${encodeURIComponent(stem)}` : '',
        }
      })
    }
    const stem = media.mediaId ? (getStemForMedia(media.mediaId) ?? media.mediaId) : ''
    return [{
      id: media.mediaId || stableId,
      filename: media.url.split('/').pop()?.split('?')[0] || 'preview',
      project: '', path: '', size: 0,
      type: media.type === 'image' ? 'image/png' : 'video/mp4',
      modified: '', thumb: null,
      meta: stem ? `/api/bridge/meta/${encodeURIComponent(stem)}` : '',
    }]
  }, [media, stableId])

  const viewerInitialIndex = media?.gallery?.index ?? 0

  // Map entry ID → pre-loaded blob URL (only when urls were provided)
  const gallerySrcMap = useMemo(() => {
    if (!media?.gallery) return null
    const urls = media.gallery.urls ?? []
    if (urls.length === 0) return null
    const map = new Map<string, string>()
    urls.forEach((url, i) => {
      const mid = media.gallery!.mediaIds?.[i]
      if (url) map.set(mid || `gallery-${i}`, url)
    })
    return map.size > 0 ? map : null
  }, [media?.gallery])

  const getViewerSrc = useCallback((entry: DiskMediaEntry) => {
    if (gallerySrcMap) return gallerySrcMap.get(entry.id)
    if (media?.gallery) return undefined  // gallery without pre-loaded URLs — use loadFullSrc
    return media?.url
  }, [media?.url, gallerySrcMap, media?.gallery])

  // Async per-entry loader for gallery mode when URLs aren't pre-loaded
  const loadGalleryFullSrc = useCallback(async (entry: DiskMediaEntry): Promise<string | undefined> => {
    if (entry.id.startsWith('gallery-')) return undefined  // no real mediaId
    const file = await loadMedia(entry.id)
    if (!file) return undefined
    return URL.createObjectURL(file)
  }, [])

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
      {media && media.type !== 'text' && viewerEntries.length > 0 && (
        <FullscreenViewer
          entries={viewerEntries}
          initialIndex={viewerInitialIndex}
          onClose={close}
          getSrc={getViewerSrc}
          loadFullSrc={media.gallery?.mediaIds?.length ? loadGalleryFullSrc : undefined}
          reviewStatuses={Object.keys(reviewStatusesMap).length ? reviewStatusesMap : undefined}
          onFavoriteToggle={(id) => { void handleFavoriteToggle(id) }}
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
