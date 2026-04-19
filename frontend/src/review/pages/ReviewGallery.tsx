import { useEffect, useState, useCallback, useRef } from 'react'
import { rhApi } from '../services/api'
import { useSocketStore } from '../stores/socketStore'
import { useUserStore } from '../stores/userStore'
import { toast } from '../stores/toastStore'
import { useGalleryData, useFilteredMedia } from '../hooks/useGalleryData'
import DirectorySidebar from '../components/DirectorySidebar'
import { MediaGrid } from '../components/MediaGrid'
import { FilterBar } from '../components/FilterBar'
import { StatsBar } from '../components/StatsBar'
import { BulkBar } from '../components/BulkBar'
import { ContextMenu } from '../components/ContextMenu'
import { MoveDialog } from '../components/MoveDialog'
import { DeleteConfirmModal } from '../components/DeleteConfirmModal'
import { Sidebar } from '../components/Sidebar'
import { Lightbox } from '../components/Lightbox'
import { AssetsPanel } from '../components/AssetsPanel'
import { SplitDivider } from '../components/SplitDivider'

type Tab = 'gallery' | 'references' | 'assets'

export function ReviewGallery() {
  const [tab, setTab] = useState<Tab>('gallery')
  const [splitMode, setSplitMode] = useState(false)
  const [splitRatio, setSplitRatio] = useState(0.5)

  // Filters
  const [activeDirectory, setActiveDirectory] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [search, setSearch] = useState('')

  // UI
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null)
  const [lightboxIndex, setLightboxIndex] = useState(-1)
  const lastSelectedIndexRef = useRef(-1)

  // Modals
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; media_id: number } | null>(null)
  const [moveTarget, setMoveTarget] = useState<number[] | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id?: number; ids?: number[]; filename?: string } | null>(null)

  // References
  interface ReferenceItem { id: number; filename: string; tags?: string | null }
  const [refs, setRefs] = useState<ReferenceItem[]>([])
  const [refSearch, setRefSearch] = useState('')
  const [refTag, setRefTag] = useState('')
  const [draggingOver, setDraggingOver] = useState(false)

  const bumpMedia = useSocketStore(s => s.bumpMediaVersion)
  const is_admin = useUserStore(s => s.is_admin)
  const user_name = useUserStore(s => s.user_name)

  const { mediaList, directories, subfolders, loadMedia, loadDirs } = useGalleryData(activeDirectory)
  const { filteredMedia, stats } = useFilteredMedia(mediaList, activeFilter, sortBy, search)

  const loadRefs = useCallback(async (signal?: AbortSignal) => {
    try { const p: Record<string, string> = {}; if (refSearch) p.search = refSearch; if (refTag) p.tag = refTag
      const d = await rhApi.listReferences(p, signal); if (!signal?.aborted) setRefs((d.items || []) as ReferenceItem[])
    } catch (e) { if (e instanceof Error && e.name !== 'AbortError') { /* swallow */ } }
  }, [refSearch, refTag])

  useEffect(() => {
    if (tab !== 'references') return
    const c = new AbortController(); void loadRefs(c.signal); return () => { c.abort() }
  }, [tab, loadRefs])

  const handleSelect = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation(); const idx = filteredMedia.findIndex(m => m.id === id)
    if (e.shiftKey && lastSelectedIndexRef.current >= 0) {
      const s = Math.min(lastSelectedIndexRef.current, idx), end = Math.max(lastSelectedIndexRef.current, idx)
      setSelectedIds(prev => { const n = new Set(prev); for (let i = s; i <= end; i++) n.add(filteredMedia[i].id); return n })
    } else {
      setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
    }
    lastSelectedIndexRef.current = idx
  }, [filteredMedia])

  const handleToggleExpand = useCallback((dir: string) => {
    setExpandedDirs(prev => { const n = new Set(prev); if (n.has(dir)) n.delete(dir); else n.add(dir); return n })
  }, [])
  const handleCreateFolder = useCallback(async (project: string, name: string) => {
    try { await rhApi.createFolder({ project, name }); toast.success(`Folder "${name}" created`); void loadDirs() }
    catch { toast.error('Failed to create folder') }
  }, [loadDirs])
  const handleContextMenu = useCallback((id: number, e: React.MouseEvent) => {
    e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, media_id: id })
  }, [])
  const buildContextItems = () => {
    if (!contextMenu) return []; const mid = contextMenu.media_id; const m = mediaList.find(x => x.id === mid)
    return [{ label: 'Open in Lightbox', on_click: () => setLightboxIndex(filteredMedia.findIndex(x => x.id === mid)) },
      { label: 'Move', on_click: () => setMoveTarget([mid]) },
      ...(is_admin ? [{ label: 'Delete', danger: true, on_click: () => setDeleteConfirm({ id: mid, filename: m?.filename }) }] : [])]
  }
  const handleClearSelection = useCallback(() => { setSelectedIds(new Set()); lastSelectedIndexRef.current = -1 }, [])
  const handleSelectAll = () => setSelectedIds(new Set(filteredMedia.map(m => m.id)))
  const handleBulkApprove = async () => {
    for (const id of selectedIds) await rhApi.toggleFavorite({ media_id: id, user_name: user_name, status: 'approved' })
    toast.success(`${selectedIds.size} items approved`); handleClearSelection(); bumpMedia()
  }
  const handleBulkReject = async () => {
    for (const id of selectedIds) await rhApi.toggleFavorite({ media_id: id, user_name: user_name, status: 'rejected' })
    toast.success(`${selectedIds.size} items rejected`); handleClearSelection(); bumpMedia()
  }
  const handleBulkDownload = () => { for (const id of selectedIds) window.open(rhApi.downloadUrl(id), '_blank') }
  const handleBulkDelete = () => setDeleteConfirm({ ids: [...selectedIds] })
  const handleBulkMove = () => setMoveTarget([...selectedIds])
  const confirmDelete = async () => {
    if (!deleteConfirm) return
    try { if (deleteConfirm.ids) { await rhApi.bulkDeleteMedia(deleteConfirm.ids); toast.success(`${deleteConfirm.ids.length} items deleted`) }
      else if (deleteConfirm.id != null) { await rhApi.deleteMedia(deleteConfirm.id); toast.success('Item deleted') }
      handleClearSelection(); bumpMedia()
    } catch (e) { toast.error(`Delete failed: ${e instanceof Error ? e.message : e}`) }
    setDeleteConfirm(null)
  }
  const confirmMove = async (targetDir: string) => {
    if (!moveTarget) return
    try { for (const id of moveTarget) await rhApi.moveToFolder({ media_id: id, target_dir: targetDir })
      toast.success(`Moved ${moveTarget.length} item(s)`); handleClearSelection(); bumpMedia()
    } catch { toast.error('Move failed') }
    setMoveTarget(null)
  }
  const handleSingleDelete = useCallback((id: number) => {
    setDeleteConfirm({ id, filename: mediaList.find(x => x.id === id)?.filename })
  }, [mediaList])

  const uploadRefFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    try { await rhApi.uploadReference(file, activeDirectory ?? undefined) }
    catch { toast.error(`Failed to upload ${file.name}`) }
  }, [activeDirectory])
  const handleRefUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files || files.length === 0) return
    await Promise.all(Array.from(files).map(uploadRefFile)); loadRefs(); e.target.value = ''
  }
  const handleRefDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.types.includes('Files')) setDraggingOver(true) }
  const handleRefDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingOver(false) }
  const handleRefDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation(); setDraggingOver(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')); if (!files.length) return
    await Promise.all(files.map(uploadRefFile)); loadRefs()
  }
  const handleRefDelete = async (id: number) => { await rhApi.deleteReference(id); loadRefs() }

  const selectedMedia = selectedMediaId != null ? mediaList.find(m => m.id === selectedMediaId) ?? null : null
  const lightboxMedia = lightboxIndex >= 0 ? filteredMedia[lightboxIndex] : null
  const moveFolders = [...directories.map(d => ({ name: d.name, path: d.name, is_project: true })),
    ...subfolders.map(s => ({ name: s.path, path: s.path, is_project: false }))]

  return (
    <div className="rh-page">
      <DirectorySidebar directories={directories} subfolders={subfolders} active_directory={activeDirectory}
        expanded_dirs={expandedDirs} on_select_dir={setActiveDirectory} on_toggle_expand={handleToggleExpand} on_create_folder={handleCreateFolder} />
      <div className="rh-content">
        <div className="rh-tab-bar">
          <button className={`rh-tab ${tab === 'gallery' && !splitMode ? 'rh-tab-active' : ''}`} onClick={() => { setTab('gallery'); setSplitMode(false) }}>Gallery</button>
          <button className={`rh-tab ${tab === 'references' ? 'rh-tab-active' : ''}`} onClick={() => { setTab('references'); setSplitMode(false) }}>References</button>
          <button className={`rh-tab ${tab === 'assets' && !splitMode ? 'rh-tab-active' : ''}`} onClick={() => { setTab('assets'); setSplitMode(false) }}>Assets</button>
          <button className={`rh-tab rh-tab-split ${splitMode ? 'rh-tab-split-active' : ''}`} onClick={() => { setSplitMode(!splitMode); if (!splitMode) setTab('gallery') }}>Split</button>
        </div>

        {splitMode && (
          <div className="rh-split-container">
            <div className="rh-split-left" style={{ flex: splitRatio }}>
              <FilterBar search={search} active_filter={activeFilter} sort_by={sortBy}
                on_search_change={setSearch} on_filter_change={setActiveFilter} on_sort_change={setSortBy} />
              {selectedIds.size > 0 && (
                <BulkBar selected_count={selectedIds.size} total_count={filteredMedia.length} is_admin={is_admin}
                  on_select_all={handleSelectAll} on_clear={handleClearSelection}
                  on_approve={handleBulkApprove} on_reject={handleBulkReject}
                  on_download={handleBulkDownload} on_delete={handleBulkDelete} on_move={handleBulkMove} />
              )}
              <StatsBar total={stats.total} favorite_count={stats.favorite_count} comment_count={stats.comment_count} />
              <div className="rh-gallery-area">
                <MediaGrid items={filteredMedia} selectedId={selectedMediaId}
                  onSelect={(id) => setLightboxIndex(filteredMedia.findIndex(m => m.id === id))}
                  onDoubleClick={(id) => setLightboxIndex(filteredMedia.findIndex(m => m.id === id))}
                  selected_ids={selectedIds} show_checkboxes={selectedIds.size > 0} is_admin={is_admin}
                  split_mode={true}
                  on_card_select={handleSelect} on_context_menu={handleContextMenu}
                  on_delete={handleSingleDelete} />
              </div>
            </div>
            <SplitDivider on_ratio_change={setSplitRatio} />
            <div className="rh-split-right" style={{ flex: 1 - splitRatio }}>
              <AssetsPanel active={true} split_mode={true} />
            </div>
          </div>
        )}

        {tab === 'gallery' && !splitMode && <>
          <FilterBar search={search} active_filter={activeFilter} sort_by={sortBy}
            on_search_change={setSearch} on_filter_change={setActiveFilter} on_sort_change={setSortBy} />
          {selectedIds.size > 0 && (
            <BulkBar selected_count={selectedIds.size} total_count={filteredMedia.length} is_admin={is_admin}
              on_select_all={handleSelectAll} on_clear={handleClearSelection}
              on_approve={handleBulkApprove} on_reject={handleBulkReject}
              on_download={handleBulkDownload} on_delete={handleBulkDelete} on_move={handleBulkMove} />
          )}
          <StatsBar total={stats.total} favorite_count={stats.favorite_count} comment_count={stats.comment_count} />
          <div className="rh-gallery-area">
            <MediaGrid items={filteredMedia} selectedId={selectedMediaId}
              onSelect={(id) => setLightboxIndex(filteredMedia.findIndex(m => m.id === id))}
              onDoubleClick={(id) => setLightboxIndex(filteredMedia.findIndex(m => m.id === id))}
              selected_ids={selectedIds} show_checkboxes={selectedIds.size > 0} is_admin={is_admin}
              on_card_select={handleSelect} on_context_menu={handleContextMenu}
              on_delete={handleSingleDelete} />
          </div>
          {selectedMedia && <Sidebar media={selectedMedia} onClose={() => setSelectedMediaId(null)} onRefresh={loadMedia} />}
        </>}

        {tab === 'references' && (
          <div className={`rh-refs${draggingOver ? ' rh-refs-drop-active' : ''}`} onDragOver={handleRefDragOver} onDragLeave={handleRefDragLeave} onDrop={handleRefDrop}>
            {draggingOver && <div className="rh-refs-drop-overlay"><span className="rh-refs-drop-label">Drop to upload</span></div>}
            <div className="rh-refs-bar">
              <input className="rh-search" placeholder="Search references..." value={refSearch} onChange={e => setRefSearch(e.target.value)} />
              <input className="rh-search" placeholder="Filter by tag..." value={refTag} onChange={e => setRefTag(e.target.value)} style={{ maxWidth: 150 }} />
              <label className="rh-upload-btn">Upload<input type="file" accept="image/*" multiple onChange={handleRefUpload} hidden /></label>
            </div>
            {refs.length === 0
              ? <div className="rh-refs-empty">No references yet. Upload images or drag files here.</div>
              : <div className="rh-refs-grid">{refs.map(item => (
                  <div key={item.id} className="rh-ref-card">
                    <img src={`/references/${item.filename}`} alt={item.filename} className="rh-ref-img" loading="lazy" />
                    <div className="rh-ref-info">
                      <span className="rh-ref-name">{item.filename}</span>
                      {item.tags && <span className="rh-ref-tags">{item.tags}</span>}
                      {is_admin && <button className="rh-ref-delete" onClick={() => handleRefDelete(item.id)}>x</button>}
                    </div>
                  </div>
                ))}</div>}
          </div>
        )}

        {!splitMode && <AssetsPanel active={tab === 'assets'} />}
      </div>

      {lightboxMedia && (
        <Lightbox media={lightboxMedia} items={filteredMedia}
          on_close={() => setLightboxIndex(-1)}
          on_navigate={(id) => setLightboxIndex(filteredMedia.findIndex(m => m.id === id))}
          on_refresh={loadMedia} />
      )}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} items={buildContextItems()} on_close={() => setContextMenu(null)} />}
      {moveTarget && <MoveDialog folders={moveFolders} on_select={confirmMove} on_close={() => setMoveTarget(null)} />}
      {deleteConfirm && (
        <DeleteConfirmModal filename={deleteConfirm.filename} count={deleteConfirm.ids?.length}
          on_confirm={confirmDelete} on_cancel={() => setDeleteConfirm(null)} />
      )}
    </div>
  )
}
