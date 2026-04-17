import { useEffect, useState, useCallback } from 'react'
import { saveMediaForProject, generateMediaId } from '../mediaStore'
import styles from './media/MediaBrowser.module.css'

export interface AssetItem {
  id: number
  filename: string
  directory: string | null
  mime_type: string | null
  asset_url: string
  thumbnail_url: string | null
}

interface Props {
  open: boolean
  onDragStart?: () => void
  onDragEnd: () => void
}

export function AssetsTab({ open, onDragStart, onDragEnd }: Props) {
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [fetched, setFetched] = useState(false)

  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setFetched(false)
  }

  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const params = activeFolder ? `?directory=${encodeURIComponent(activeFolder)}` : ''
    fetch(`/api/bridge/assets${params}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: AssetItem[]) => {
        setAssets(data)
        if (!activeFolder) {
          const dirs = [...new Set(data.map(a => a.directory).filter(Boolean))] as string[]
          setFolders(dirs.sort())
        }
        setFetched(true)
      })
      .catch(err => {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.warn('[AYCB] Assets fetch failed:', err)
          setFetched(true)
        }
      })
    return () => ctrl.abort()
  }, [open, activeFolder])

  const handleDragStart = useCallback((item: AssetItem, e: React.DragEvent) => {
    const mediaId = generateMediaId()
    fetch(item.asset_url)
      .then(r => r.blob())
      .then(blob => {
        const mimeType = blob.type || item.mime_type || 'image/png'
        const ext = mimeType.split('/')[1] ?? 'png'
        const file = new File([blob], item.filename || `asset-${item.id}.${ext}`, { type: mimeType })
        return saveMediaForProject(mediaId, file)
      })
      .catch(err => console.warn('[AYCB] Asset drag save failed:', err))

    const payload = JSON.stringify([{
      mediaId,
      type: item.mime_type || 'image/png',
      name: item.filename,
    }])
    e.dataTransfer.setData('application/x-aycb-media', payload)
    e.dataTransfer.effectAllowed = 'copy'
    onDragStart?.()
  }, [onDragStart])

  const loading = open && !fetched
  const displayAssets = activeFolder
    ? assets.filter(a => a.directory === activeFolder)
    : assets

  return (
    <>
      {folders.length > 0 && (
        <div className={styles.controls}>
          <label className={styles.controlLabel}>
            Folder
            <select
              className={styles.controlSelect}
              value={activeFolder ?? ''}
              onChange={e => setActiveFolder(e.target.value || null)}
            >
              <option value="">All</option>
              {folders.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className={styles.grid}>
        {loading && <p className={styles.empty}>Loading assets...</p>}
        {!loading && displayAssets.length === 0 && (
          <p className={styles.empty}>
            {assets.length === 0 ? 'No assets in shared/Assets/' : 'No assets in this folder'}
          </p>
        )}
        {displayAssets.map(item => (
          <div
            key={item.id}
            className={styles.item}
            draggable
            onDragStart={(e) => handleDragStart(item, e)}
            onDragEnd={onDragEnd}
          >
            <div className={styles.thumbWrap}>
              {item.mime_type?.startsWith('video/') ? (
                <div className={styles.videoPlaceholder}>Video</div>
              ) : (
                <img
                  src={item.thumbnail_url || item.asset_url}
                  alt={item.filename}
                  className={styles.thumb}
                />
              )}
              <div className={styles.thumbOverlay}>
                <span className={styles.overlayName} title={item.filename}>{item.filename}</span>
                {item.directory && (
                  <span className={styles.overlayMeta}>{item.directory}</span>
                )}
              </div>
            </div>
            <span className={styles.itemName} title={item.filename}>{item.filename}</span>
          </div>
        ))}
      </div>
    </>
  )
}
