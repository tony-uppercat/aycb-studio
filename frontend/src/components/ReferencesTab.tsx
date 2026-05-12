import { useEffect, useState } from 'react'
import styles from './media/MediaBrowser.module.css'

export interface ReferenceItem {
  id: number
  filename: string
  uploaded_by: string | null
  tags: string | null
  width: number | null
  height: number | null
}

interface Props {
  open: boolean
  onDragStart: (ref: ReferenceItem, e: React.DragEvent) => void
  onDragEnd: () => void
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : [raw] } catch { return raw.split(',').map(s => s.trim()).filter(Boolean) }
}

export function ReferencesTab({ open, onDragStart, onDragEnd }: Props) {
  const [references, setReferences] = useState<ReferenceItem[]>([])
  const [fetched, setFetched] = useState(false)
  const [search, setSearch] = useState('')
  const [viewId, setViewId] = useState<number | null>(null)

  // Reset fetch state when open changes (React "previous render" pattern)
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setFetched(false)
  }

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    fetch('/api/bridge/references', { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: ReferenceItem[]) => {
        setReferences(data); setFetched(true)
      })
      .catch(err => {
        if (err.name !== 'AbortError') { console.warn('[AYCB] References fetch failed:', err); setFetched(true) }
      })
    return () => { controller.abort() }
  }, [open])

  const loading = open && !fetched

  const filtered = search.trim()
    ? references.filter(r =>
        r.filename.toLowerCase().includes(search.toLowerCase()) ||
        parseTags(r.tags).some(t => t.toLowerCase().includes(search.toLowerCase()))
      )
    : references

  return (
    <>
      <div className={styles.refSearch}>
        <input
          className={styles.refSearchInput}
          type="text"
          placeholder="Search by name or tag..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.grid}>
        {loading && <p className={styles.empty}>Loading references...</p>}
        {!loading && filtered.length === 0 && (
          <p className={styles.empty}>
            {references.length === 0 ? 'No references available' : 'No matches'}
          </p>
        )}
        {filtered.map(ref => (
          <div
            key={ref.id}
            className={styles.item}
            draggable
            onDragStart={(e) => onDragStart(ref, e)}
            onDragEnd={onDragEnd}
            onClick={() => setViewId(ref.id)}
            onDoubleClick={() => setViewId(ref.id)}
          >
            <div className={styles.thumbWrap}>
              <img
                src={`/api/bridge/references/${ref.id}/image`}
                alt={ref.filename}
                className={styles.thumb}
              />
              <span className={styles.refBadge}>REF</span>
              <div className={styles.thumbOverlay}>
                <span className={styles.overlayName} title={ref.filename}>{ref.filename}</span>
                {ref.uploaded_by && (
                  <span className={styles.overlayMeta}>{ref.uploaded_by}</span>
                )}
              </div>
            </div>
            <span className={styles.itemName} title={ref.filename}>{ref.filename}</span>
            {(() => { const t = parseTags(ref.tags); return t.length > 0 ? (
              <div className={styles.tagRow}>
                {t.map(tag => (
                  <span key={tag} className={styles.tagPill}>{tag}</span>
                ))}
              </div>
            ) : null })()}
          </div>
        ))}
      </div>

      {viewId !== null && (() => {
        const ref = references.find(r => r.id === viewId)
        if (!ref) return null
        return (
          <>
            <div className={styles.galleryOverlay} onClick={() => setViewId(null)} />
            <div className={styles.galleryContainer}>
              <img
                src={`/api/bridge/references/${ref.id}/image`}
                alt={ref.filename}
                className={styles.galleryMedia}
              />
              <div className={styles.galleryInfo}>
                <span>{ref.filename}</span>
                {ref.uploaded_by && <span>{ref.uploaded_by}</span>}
                {(() => { const t = parseTags(ref.tags); return t.length > 0 ? <span>{t.join(', ')}</span> : null })()}
              </div>
              <button className={styles.galleryClose} onClick={() => setViewId(null)}>&#x2715;</button>
            </div>
          </>
        )
      })()}
    </>
  )
}
