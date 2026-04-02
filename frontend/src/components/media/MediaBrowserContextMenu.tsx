/**
 * Right-click context menu for Fullscreen Media Browser items.
 *
 * Actions:
 * - Preview (open in preview mode)
 * - Import to Current Project (creates ImageUpload node)
 * - Download
 * - Open in Review Hub
 * - Copy Path
 */
import { useCallback, useEffect, useState } from 'react'
import type { DiskMediaEntry } from './FullscreenMediaBrowser'
import styles from './MediaBrowserContextMenu.module.css'

export interface MediaContextMenuProps {
  x: number
  y: number
  entry: DiskMediaEntry
  onClose: () => void
  onPreview?: () => void
  onImportToProject?: (entry: DiskMediaEntry) => void
  onDownload?: (entry: DiskMediaEntry) => void
  onOpenInReviewHub?: (entry: DiskMediaEntry) => void
}

export function MediaBrowserContextMenu({
  x, y, entry, onClose,
  onPreview, onImportToProject, onDownload, onOpenInReviewHub,
}: MediaContextMenuProps) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const menuX = Math.min(x, window.innerWidth - 250)
  const menuY = Math.min(y, window.innerHeight - 260)

  const handleCopyPath = useCallback(() => {
    const dir = entry.path || entry.project
    const fullPath = `shared/Media/${dir}/${entry.filename}`
    navigator.clipboard.writeText(fullPath).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false); onClose() }, 800)
    }).catch(() => onClose())
  }, [entry, onClose])

  const handleFindInExplorer = useCallback(() => {
    const dir = entry.path || entry.project
    fetch(`/api/bridge/explore/${encodeURIComponent(dir)}/${encodeURIComponent(entry.filename)}`, { method: 'POST' }).catch(e => console.warn('[bridge] explore failed:', e.message ?? e))
    onClose()
  }, [entry, onClose])

  const handleImport = useCallback(() => {
    onImportToProject?.(entry)
    onClose()
  }, [onImportToProject, entry, onClose])

  const handleDownload = useCallback(() => {
    onDownload?.(entry)
    onClose()
  }, [onDownload, entry, onClose])

  const handlePreview = useCallback(() => {
    onPreview?.()
    onClose()
  }, [onPreview, onClose])

  const handleReviewHub = useCallback(() => {
    onOpenInReviewHub?.(entry)
    onClose()
  }, [onOpenInReviewHub, entry, onClose])

  return (
    <>
      <div className={styles.overlay} onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div className={styles.menu} style={{ left: menuX, top: menuY }}>
        <div className={styles.header}>{entry.filename}</div>

        <button className={styles.item} onClick={handlePreview}>
          <span className={styles.icon}>👁</span>
          <span className={styles.label}>Preview</span>
        </button>

        <button className={`${styles.item} ${styles.itemHighlight}`} onClick={handleImport}>
          <span className={styles.icon}>📥</span>
          <span className={styles.label}>Import to Project</span>
        </button>

        <button className={styles.item} onClick={handleDownload}>
          <span className={styles.icon}>↓</span>
          <span className={styles.label}>Download</span>
        </button>

        <button className={styles.item} onClick={handleReviewHub}>
          <span className={styles.icon}>👁</span>
          <span className={styles.label}>Open in Review Hub</span>
        </button>

        <button className={styles.item} onClick={handleFindInExplorer}>
          <span className={styles.icon}>📂</span>
          <span className={styles.label}>Find in Explorer</span>
        </button>

        <div className={styles.separator} />

        <button className={styles.item} onClick={handleCopyPath}>
          <span className={styles.icon}>{copied ? '✓' : '📎'}</span>
          <span className={`${styles.label} ${copied ? styles.copied : ''}`}>
            {copied ? 'Copied!' : 'Copy Path'}
          </span>
        </button>
      </div>
    </>
  )
}
