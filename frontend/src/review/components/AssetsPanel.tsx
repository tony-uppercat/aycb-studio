import { useEffect, useState, useCallback, useRef } from 'react'
import { rhApi } from '../services/api'
import { onEvent, offEvent } from '../services/socket'
import { useUserStore } from '../stores/userStore'
import { toast } from '../stores/toastStore'
import { ContextMenu } from './ContextMenu'

interface AssetItem {
  id: number
  filename: string
  directory: string | null
  file_size: number | null
  mime_type: string | null
  width: number | null
  height: number | null
  asset_url: string
  thumbnail_url: string | null
  is_link?: boolean
  media_id?: number
  link_id?: number
}

interface Props {
  active: boolean
  split_mode?: boolean
}

export function AssetsPanel({ active, split_mode }: Props) {
  const is_admin = useUserStore(s => s.is_admin)

  const [folders, setFolders] = useState<string[]>([])
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [viewUrl, setViewUrl] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: { label: string; danger?: boolean; on_click: () => void }[] } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const newFolderRef = useRef<HTMLInputElement>(null)

  const loadFolders = useCallback(async (parent: string | null, signal?: AbortSignal) => {
    try { const d = await rhApi.listAssetFolders(parent ?? undefined, signal); if (!signal?.aborted) setFolders(d.folders) }
    catch (e) { if (e instanceof Error && e.name !== 'AbortError') { /* swallow */ } }
  }, [])

  const loadAssets = useCallback(async (directory: string | null, signal?: AbortSignal) => {
    try { const d = await rhApi.listAssets(directory ? { directory } : undefined, signal); if (!signal?.aborted) setAssets((d.items || []) as AssetItem[]) }
    catch (e) { if (e instanceof Error && e.name !== 'AbortError') { /* swallow */ } }
  }, [])

  useEffect(() => {
    if (!active) return
    const c = new AbortController()
    void loadFolders(activeFolder, c.signal); void loadAssets(activeFolder, c.signal)
    return () => c.abort()
  }, [active, activeFolder, loadFolders, loadAssets])

  useEffect(() => {
    if (!active) return
    const refresh = () => { void loadFolders(activeFolder); void loadAssets(activeFolder) }
    onEvent('assets_update', refresh)
    onEvent('asset_link_new', refresh)
    onEvent('asset_link_delete', refresh)
    return () => { offEvent('assets_update', refresh); offEvent('asset_link_new', refresh); offEvent('asset_link_delete', refresh) }
  }, [active, activeFolder, loadAssets, loadFolders])

  const handleCreateFolder = async () => {
    const name = newFolderName.trim(); if (!name) return
    try { await rhApi.createAssetFolder(activeFolder ? `${activeFolder}/${name}` : name); toast.success(`Folder "${name}" created`); setNewFolderName(''); void loadFolders(activeFolder) }
    catch { toast.error('Failed to create folder') }
  }
  const handleDeleteFolder = async (fullPath: string) => {
    if (!confirm(`Delete folder "${fullPath.split('/').pop()}"? It must be empty.`)) return
    try { await rhApi.deleteAssetFolder(fullPath); toast.success('Folder deleted')
      if (activeFolder === fullPath) setActiveFolder(fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/')) : null)
      else void loadFolders(activeFolder)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to delete') }
  }
  const handleStartRename = (folder: string) => { setRenamingFolder(folder); setRenameValue(folder.split('/').pop() || folder) }
  const handleRename = async () => {
    if (!renamingFolder || !renameValue.trim()) return
    try { const d = await rhApi.renameAssetFolder(renamingFolder, renameValue.trim()); toast.success('Folder renamed')
      if (activeFolder === renamingFolder) setActiveFolder(d.new_path); setRenamingFolder(null); setRenameValue(''); void loadFolders(activeFolder)
    } catch { toast.error('Failed to rename folder') }
  }
  const handleDeleteAsset = async (id: number) => {
    if (!confirm('Delete this asset?')) return
    try { await rhApi.deleteAsset(id); setAssets(prev => prev.filter(a => a.id !== id)); toast.success('Asset deleted') }
    catch { toast.error('Failed to delete asset') }
  }

  const handleGridContext = (e: React.MouseEvent) => {
    e.preventDefault()
    if (is_admin) setCtxMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'New Folder', on_click: () => newFolderRef.current?.focus() }] })
  }
  const handleFolderContext = (e: React.MouseEvent, folder: string) => {
    e.preventDefault(); e.stopPropagation()
    const fp = activeFolder ? `${activeFolder}/${folder}` : folder
    setCtxMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open', on_click: () => setActiveFolder(fp) },
      ...(is_admin ? [{ label: 'Rename', on_click: () => handleStartRename(folder) }, { label: 'Delete Folder', danger: true, on_click: () => handleDeleteFolder(fp) }] : []),
    ] })
  }
  const handleAssetContext = (e: React.MouseEvent, asset: AssetItem) => {
    e.preventDefault(); e.stopPropagation()
    const items: { label: string; danger?: boolean; on_click: () => void }[] = [{ label: 'Open', on_click: () => setViewUrl(asset.asset_url) }]
    if (asset.is_link && asset.link_id) items.push({ label: 'Remove Link', danger: true, on_click: () => void handleUnlink(asset.link_id!) })
    else if (is_admin) items.push({ label: 'Delete', danger: true, on_click: () => void handleDeleteAsset(asset.id) })
    setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }

  const handleGridDragOver = (e: React.DragEvent) => {
    if (!split_mode || !e.dataTransfer.types.includes('text/x-media-id')) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'link'; setDropTarget('grid')
  }
  const handleGridDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null)
  }
  const handleGridDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDropTarget(null)
    const mediaId = e.dataTransfer.getData('text/x-media-id')
    if (!mediaId) return
    try {
      await rhApi.linkAsset({ media_id: Number(mediaId), directory: activeFolder || '' })
      toast.success('Linked to assets'); void loadAssets(activeFolder)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Link failed') }
  }
  const handleFolderDragOver = (e: React.DragEvent, folder: string) => {
    if (!split_mode || !e.dataTransfer.types.includes('text/x-media-id')) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'link'
    setDropTarget(activeFolder ? `${activeFolder}/${folder}` : folder)
  }
  const handleFolderDrop = async (e: React.DragEvent, folder: string) => {
    e.preventDefault(); setDropTarget(null)
    const mediaId = e.dataTransfer.getData('text/x-media-id')
    if (!mediaId) return
    const fullPath = activeFolder ? `${activeFolder}/${folder}` : folder
    try {
      await rhApi.linkAsset({ media_id: Number(mediaId), directory: fullPath })
      toast.success(`Linked to ${folder}`)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Link failed') }
  }
  const handleUnlink = async (linkId: number) => {
    try {
      await rhApi.unlinkAsset(linkId); toast.success('Link removed'); void loadAssets(activeFolder)
    } catch { toast.error('Failed to remove link') }
  }

  if (!active) return null

  return (
    <div className="rh-assets-layout">
      <div className="rh-assets-sidebar">
        <div className="rh-assets-sidebar-header">Folders</div>
        <div className={`rh-assets-folder-row ${activeFolder === null ? 'rh-assets-folder-active' : ''}`} onClick={() => setActiveFolder(null)}>All Assets</div>
        {folders.map(folder => (
          <div
            key={folder}
            className={`rh-assets-folder-row ${activeFolder === folder ? 'rh-assets-folder-active' : ''}${dropTarget === (activeFolder ? `${activeFolder}/${folder}` : folder) ? ' rh-assets-folder-drop-active' : ''}`}
            onContextMenu={e => handleFolderContext(e, folder)}
            onDragOver={e => handleFolderDragOver(e, folder)} onDragLeave={() => setDropTarget(null)} onDrop={e => handleFolderDrop(e, folder)}
          >
            {renamingFolder === folder
              ? <input className="rh-assets-rename-input" value={renameValue} autoFocus onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleRename(); if (e.key === 'Escape') setRenamingFolder(null) }}
                  onBlur={() => setRenamingFolder(null)} onClick={e => e.stopPropagation()} />
              : <span className="rh-assets-folder-name" onClick={() => setActiveFolder(activeFolder ? `${activeFolder}/${folder}` : folder)}>{folder}</span>}
            {is_admin && renamingFolder !== folder && (
              <span className="rh-assets-folder-actions">
                <button className="rh-assets-icon-btn" onClick={() => handleStartRename(folder)} title="Rename">&#9998;</button>
                <button className="rh-assets-icon-btn rh-assets-icon-danger" onClick={() => handleDeleteFolder(activeFolder ? `${activeFolder}/${folder}` : folder)} title="Delete">&#10005;</button>
              </span>
            )}
          </div>
        ))}
        {is_admin && <div className="rh-assets-new-folder">
          <input className="rh-assets-new-folder-input" ref={newFolderRef} placeholder="New folder..." value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void handleCreateFolder() }} />
          <button className="rh-assets-create-btn" onClick={handleCreateFolder}>+</button>
        </div>}
      </div>

      <div className={`rh-assets-content${dropTarget === 'grid' ? ' rh-assets-drop-active' : ''}`} onContextMenu={handleGridContext}
        onDragOver={handleGridDragOver} onDragLeave={handleGridDragLeave} onDrop={handleGridDrop}>
        {activeFolder && (
          <div className="rh-assets-breadcrumb">
            <span className="rh-assets-crumb-link" onClick={() => setActiveFolder(null)}>All</span>
            {activeFolder.split('/').map((seg, i, arr) => {
              const isLast = i === arr.length - 1
              const path = arr.slice(0, i + 1).join('/')
              return (
                <span key={path}>
                  <span className="rh-assets-crumb-sep">/</span>
                  <span className={isLast ? 'rh-assets-crumb-cur' : 'rh-assets-crumb-link'} onClick={isLast ? undefined : () => setActiveFolder(path)}>{seg}</span>
                </span>
              )
            })}
          </div>
        )}
        {assets.length === 0 ? (
          <div className="rh-assets-empty">
            {activeFolder ? `No assets in "${activeFolder}"` : 'No assets yet. Drop files into shared/Assets/'}
          </div>
        ) : (
          <div className="rh-assets-grid">
            {assets.map(asset => (
              <div key={asset.id} className="rh-asset-card" onClick={() => setViewUrl(asset.asset_url)} onContextMenu={e => handleAssetContext(e, asset)}>
                {asset.is_link && <span className="rh-asset-link-badge">Link</span>}
                <div className="rh-asset-thumb-wrap">
                  {asset.mime_type?.startsWith('video/')
                    ? <div className="rh-asset-video-placeholder">Video</div>
                    : <img src={asset.thumbnail_url || asset.asset_url} alt={asset.filename} className="rh-asset-thumb" loading="lazy" />}
                </div>
                <div className="rh-asset-info">
                  <span className="rh-asset-name" title={asset.filename}>{asset.filename}</span>
                  {asset.directory && <span className="rh-asset-dir">{asset.directory}</span>}
                  {is_admin && <button className="rh-asset-delete-btn" onClick={e => { e.stopPropagation(); void handleDeleteAsset(asset.id) }}>&#10005;</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} on_close={() => setCtxMenu(null)} />}

      {viewUrl && <>
        <div className="rh-assets-overlay" onClick={() => setViewUrl(null)} />
        <div className="rh-assets-viewer">
          <img src={viewUrl} alt="" className="rh-assets-viewer-img" />
          <button className="rh-assets-viewer-close" onClick={() => setViewUrl(null)}>&#10005;</button>
        </div>
      </>}
    </div>
  )
}
