import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  listMedia,
  loadMedia,
  deleteMultipleMedia,
  listMediaIds,
  getStorageEstimate,
  loadAllThumbnails,
  generateThumbnail,
  saveThumbnail,
  type MediaEntry,
  type StorageEstimate,
} from '../../mediaStore'
import { listProjects } from '../../stores/projectStore'
import { useMediaSelection } from '../../hooks/useMediaSelection'
import { useMediaFiltering, type SortOption, type FilterOption } from '../../hooks/useMediaFiltering'
import { useMediaDrag } from '../../hooks/useMediaDrag'
import { useFavoriteToggle } from '../../hooks/useFavoriteToggle'
import { formatSize } from '../../utils/mediaFormatting'
import { fetchReviewStatus, getStemForMedia, type ReviewStatus } from '../../utils/reviewStatus'
import { FullscreenViewer } from './FullscreenViewer'
import { MediaGridItem } from './MediaGridItem'
import { ReferencesTab } from '../ReferencesTab'
import { AssetsTab } from '../AssetsTab'
import { type DiskMediaEntry } from './FullscreenMediaBrowser'
import { useCanvasStore } from '../../stores/canvasStore'
import { downloadFile, downloadFromUrl } from '../../utils/downloadManager'
import { STORAGE_KEYS } from '../../storage/keys'
import styles from './MediaBrowser.module.css'

interface Props {
  open: boolean
  onClose: () => void
}

type ActiveTab = 'media' | 'references' | 'assets'

export function MediaBrowser({ open, onClose }: Props) {
  const toggleFullscreenBrowser = useCanvasStore(s => s.toggleFullscreenBrowser)

  const [activeTab, setActiveTab] = useState<ActiveTab>('media')
  const [entries, setEntries] = useState<MediaEntry[]>([])
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [viewIndex, setViewIndex] = useState<number | null>(null)
  const [storage, setStorage] = useState<StorageEstimate | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [reviewStatuses, setReviewStatuses] = useState<Record<string, ReviewStatus | null>>({})
  const [projectFilter, setProjectFilter] = useState<string>(() => localStorage.getItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME) || 'all')
  const [projectMediaMap, setProjectMediaMap] = useState<Map<string, Set<string>>>(new Map())
  const [projectNames, setProjectNames] = useState<string[]>([])
  const thumbUrlsRef = useRef<string[]>([])

  const { selected, toggleSelect, clearSelection, selectAll } = useMediaSelection()
  const sortedFiltered = useMediaFiltering(entries, sortBy, filterBy, reviewStatuses)
  const displayList = useMemo(() => {
    if (projectFilter === 'all') return sortedFiltered
    const ids = projectMediaMap.get(projectFilter)
    if (!ids) return sortedFiltered
    return sortedFiltered.filter(e => ids.has(e.id))
  }, [sortedFiltered, projectFilter, projectMediaMap])

  const { handleDragStart, handleDragStartMulti, handleRefDragStart, handleDragEnd, closePanelAfterDrag } = useMediaDrag({
    thumbs, selected, entries, onClose,
  })
  const handleFavoriteToggle = useFavoriteToggle(setReviewStatuses)

  // Load entries + thumbnails together
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    Promise.all([listMedia(), getStorageEstimate()]).then(async ([items, est]) => {
      if (cancelled) return

      // Phase 1: Load cached thumbnails instantly (no full blob load)
      const cachedThumbs = await loadAllThumbnails(items.map(e => e.id))

      if (cancelled) return
      setEntries(items)
      setStorage(est)
      setThumbs(prev => {
        prev.forEach(u => URL.revokeObjectURL(u))
        return new Map(cachedThumbs)
      })
      thumbUrlsRef.current = [...cachedThumbs.values()]
      clearSelection()
      setViewIndex(null)
      setProjectFilter(localStorage.getItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME) || 'all')
      setLoading(false)

      // Build project -> mediaIds mapping + review statuses (concurrent with thumbnail gen)
      listProjects().then(projects => {
        const pMap = new Map<string, Set<string>>()
        for (const proj of projects) {
          const ids = new Set<string>()
          for (const mid of proj.mediaIds || []) ids.add(mid)
          for (const node of proj.canvas?.nodes || []) {
            const d = node.data as Record<string, unknown>
            if (typeof d.mediaId === 'string') ids.add(d.mediaId)
            if (Array.isArray(d.historyIds)) for (const h of d.historyIds) if (typeof h === 'string') ids.add(h)
            if (Array.isArray(d.frameIds)) for (const f of d.frameIds) if (typeof f === 'string') ids.add(f)
          }
          if (ids.size > 0) pMap.set(proj.name, ids)
        }
        if (!cancelled) {
          setProjectMediaMap(pMap)
          setProjectNames([...pMap.keys()].sort())
        }
      })
      for (const entry of items) {
        fetchReviewStatus(entry.id).then(status => {
          if (status) setReviewStatuses(prev => ({ ...prev, [entry.id]: status }))
        })
      }

      // Phase 2: Generate thumbnails for items not yet cached (background, sequential)
      const missing = items.filter(e =>
        !cachedThumbs.has(e.id) &&
        (e.type.startsWith('image/') || e.type.startsWith('video/'))
      )
      for (const e of missing) {
        if (cancelled) break
        const file = await loadMedia(e.id)
        if (!file || cancelled) continue
        try {
          const thumb = await generateThumbnail(file)
          if (cancelled) break
          await saveThumbnail(e.id, thumb)
          const url = URL.createObjectURL(thumb)
          cachedThumbs.set(e.id, url)
          setThumbs(prev => new Map([...prev, [e.id, url]]))
        } catch { /* skip failed thumbnails */ }
      }
    })
    return () => { cancelled = true }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => { thumbUrlsRef.current.forEach(u => URL.revokeObjectURL(u)) }
  }, [])

  // Keyboard navigation for fullscreen gallery
  const sortedFilteredLenRef = useRef(displayList.length)
  sortedFilteredLenRef.current = displayList.length

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return

      if (viewIndex !== null) {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault(); setViewIndex(null)
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault(); e.stopPropagation()
          setViewIndex(i => i !== null ? Math.max(0, i - 1) : null)
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation()
          setViewIndex(i => i !== null ? Math.min(sortedFilteredLenRef.current - 1, i + 1) : null)
        }
      } else if (e.code === 'Space') {
        e.preventDefault()
        if (selected.size > 0) {
          const firstId = [...selected][0]
          const idx = displayList.findIndex(x => x.id === firstId)
          if (idx >= 0) setViewIndex(idx)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, viewIndex, selected, displayList])

  // ── Action handlers ──

  function handleToggleSelect(id: string, idx: number, e: React.MouseEvent) {
    toggleSelect(id, idx, displayList.map(entry => entry.id), e.shiftKey, e.ctrlKey || e.metaKey)
  }

  async function handleDelete() {
    const ids = [...selected]
    if (!ids.length) return
    if (!confirm(`Delete ${ids.length} item${ids.length > 1 ? 's' : ''}?`)) return
    const stemsByIds = new Map<string, string>()
    for (const id of ids) {
      const entry = entries.find(e => e.id === id)
      if (entry?.name) {
        const stem = entry.name.replace(/\.[^.]+$/, '')
        if (stem) stemsByIds.set(id, stem)
      }
    }
    await deleteMultipleMedia(ids)
    clearSelection()
    ids.forEach(id => {
      const u = thumbs.get(id)
      if (u) URL.revokeObjectURL(u)
    })
    for (const stem of stemsByIds.values()) {
      fetch(`/api/bridge/media/${encodeURIComponent(stem)}`, { method: 'DELETE' })
        .catch(err => console.warn('Bridge media delete failed:', stem, err))
    }
    const [items, est] = await Promise.all([listMedia(), getStorageEstimate()])
    setEntries(items)
    setStorage(est)
  }

  async function handleDownloadAll() {
    const ids = selected.size > 0 ? [...selected] : displayList.map(e => e.id)
    for (const id of ids) {
      const file = await loadMedia(id)
      if (file) downloadFile(file)
    }
  }

  const handleDownloadSingle = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const file = await loadMedia(id)
    if (file) downloadFile(file)
  }, [])

  async function handleCleanup() {
    setCleanupBusy(true)
    try {
      const [allMediaIds, projects] = await Promise.all([listMediaIds(), listProjects()])
      const referencedIds = new Set<string>()
      for (const proj of projects) {
        for (const mid of proj.mediaIds || []) referencedIds.add(mid)
        for (const node of proj.canvas?.nodes || []) {
          const d = node.data as Record<string, unknown>
          if (typeof d.mediaId === 'string') referencedIds.add(d.mediaId)
          if (Array.isArray(d.historyIds))
            for (const h of d.historyIds) if (typeof h === 'string') referencedIds.add(h)
          if (Array.isArray(d.frameIds))
            for (const f of d.frameIds) if (typeof f === 'string') referencedIds.add(f)
        }
      }
      const orphanIds = allMediaIds.filter(id => !referencedIds.has(id))
      if (orphanIds.length === 0) {
        alert('No orphaned media found. All media is referenced by projects.')
        return
      }
      const totalBytes = entries
        .filter(e => orphanIds.includes(e.id))
        .reduce((sum, e) => sum + e.size, 0)
      if (!confirm(
        `Found ${orphanIds.length} orphaned media file${orphanIds.length > 1 ? 's' : ''} (${formatSize(totalBytes)}) not referenced by any project.\n\nDelete them?`
      )) return
      await deleteMultipleMedia(orphanIds)
      orphanIds.forEach(id => {
        const u = thumbs.get(id)
        if (u) URL.revokeObjectURL(u)
      })
      const [items, est] = await Promise.all([listMedia(), getStorageEstimate()])
      setEntries(items)
      setStorage(est)
      clearSelection()
    } finally {
      setCleanupBusy(false)
    }
  }

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0)

  if (!open) return null

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Media Browser</span>
          <span className={styles.stats}>
            {`${entries.length} items · ${formatSize(totalSize)}`}
          </span>
          <button
            className={styles.closeBtn}
            onClick={() => { onClose(); toggleFullscreenBrowser() }}
            title="Open fullscreen browser (M)"
            aria-label="Open fullscreen browser"
            style={{ marginRight: 4 }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
              <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        {/* Tab bar */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'media' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('media')}
          >
            Media{displayList.length > 0 ? ` (${displayList.length})` : ''}
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'references' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('references')}
          >
            References
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'assets' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('assets')}
          >
            Assets
          </button>
        </div>

        {activeTab === 'media' && (
          <>
            {/* Storage bar */}
            {storage && storage.quotaBytes > 0 && (
              <div className={styles.storageBar}>
                <div className={styles.storageInfo}>
                  <span>Used: {formatSize(storage.usageBytes)} / {formatSize(storage.quotaBytes)}</span>
                  <span>{storage.percentUsed}%</span>
                </div>
                <div className={styles.storageTrack}>
                  <div
                    className={`${styles.storageFill} ${storage.percentUsed > 80 ? styles.storageFillWarn : ''}`}
                    style={{ width: `${Math.min(storage.percentUsed, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Project/Sort/Filter controls */}
            <div className={styles.controls}>
              <label className={styles.controlLabel}>
                Project
                <select className={styles.controlSelect} value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
                  <option value="all">All</option>
                  {projectNames.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className={styles.controlLabel}>
                Sort
                <select className={styles.controlSelect} value={sortBy} onChange={e => setSortBy(e.target.value as SortOption)}>
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="largest">Largest</option>
                  <option value="name">Name</option>
                </select>
              </label>
              <label className={styles.controlLabel}>
                Filter
                <select className={styles.controlSelect} value={filterBy} onChange={e => setFilterBy(e.target.value as FilterOption)}>
                  <option value="all">All</option>
                  <option value="images">Images</option>
                  <option value="videos">Videos</option>
                  <option value="favorites">★ Favorites</option>
                  <option value="approved">✓ Approved</option>
                  <option value="rejected">✗ Rejected</option>
                </select>
              </label>
            </div>

            <div className={styles.toolbar}>
              <button className={styles.toolBtn} onClick={() => selectAll(displayList.map(e => e.id))} title="Select All">All</button>
              <button className={styles.toolBtn} onClick={clearSelection} title="Deselect">None</button>
              <button className={styles.toolBtn} onClick={handleCleanup} disabled={cleanupBusy} title="Remove media not referenced by any project">
                {cleanupBusy ? 'Scanning...' : 'Clean Up'}
              </button>
              <div className={styles.toolSpacer} />
              <button className={styles.toolBtn} onClick={handleDownloadAll} title={selected.size > 0 ? `Download ${selected.size}` : 'Download All'}>
                {selected.size > 0 ? `DL (${selected.size})` : 'DL All'}
              </button>
              {selected.size > 0 && (
                <button className={`${styles.toolBtn} ${styles.toolBtnDanger}`} onClick={handleDelete} title={`Delete ${selected.size}`}>
                  Del ({selected.size})
                </button>
              )}
            </div>

            <div className={styles.grid}>
              {loading && <p className={styles.empty}>Loading...</p>}
              {!loading && displayList.length === 0 && <p className={styles.empty}>No media stored</p>}
              {displayList.map((entry, i) => (
                <MediaGridItem
                  key={entry.id}
                  id={entry.id}
                  name={entry.name}
                  type={entry.type}
                  size={entry.size}
                  thumb={thumbs.get(entry.id)}
                  isSelected={selected.has(entry.id)}
                  review={reviewStatuses[entry.id] ?? null}
                  onSelect={(e) => handleToggleSelect(entry.id, i, e)}
                  onDoubleClick={() => setViewIndex(i)}
                  onDragStart={(e) => {
                    if (selected.size > 1 && selected.has(entry.id)) handleDragStartMulti(e)
                    else handleDragStart(entry, e)
                  }}
                  onDragEnd={handleDragEnd}
                  onDownload={(e) => handleDownloadSingle(entry.id, e)}
                  onFavoriteToggle={(e) => { e.stopPropagation(); void handleFavoriteToggle(entry.id) }}
                />
              ))}
            </div>
          </>
        )}

        {activeTab === 'references' && (
          <ReferencesTab
            open={open && activeTab === 'references'}
            onDragStart={handleRefDragStart}
            onDragEnd={handleDragEnd}
          />
        )}

        {activeTab === 'assets' && (
          <AssetsTab
            open={open && activeTab === 'assets'}
            onDragStart={closePanelAfterDrag}
            onDragEnd={handleDragEnd}
          />
        )}
      </div>

      {/* Fullscreen gallery viewer — media tab */}
      {viewIndex !== null && displayList[viewIndex] && (
        <FullscreenViewer
          entries={displayList.map((e): DiskMediaEntry => ({
            id: e.id,
            filename: e.name,
            project: '',
            path: '',
            size: e.size,
            type: e.type,
            modified: '',
            thumb: thumbs.get(e.id) ?? null,
            meta: `/api/bridge/meta/${encodeURIComponent(getStemForMedia(e.id) ?? e.name.replace(/\.[^.]+$/, ''))}`,
          }))}
          getSrc={e => thumbs.get(e.id) ?? undefined}
          loadFullSrc={async (e) => {
            const file = await loadMedia(e.id)
            return file ? URL.createObjectURL(file) : undefined
          }}
          initialIndex={viewIndex}
          onClose={() => setViewIndex(null)}
          reviewStatuses={reviewStatuses}
          onFavoriteToggle={handleFavoriteToggle}
          onDownload={(src, filename) => downloadFromUrl(src, filename)}
          onFindInExplorer={(e) => {
            const stem = getStemForMedia(e.id)
            if (stem) fetch(`/api/bridge/explore-stem/${encodeURIComponent(stem)}`, { method: 'POST' }).catch(e => console.warn('[bridge] explore-stem failed:', e.message ?? e))
          }}
        />
      )}
    </>
  )
}
