import { useEffect, useState, useCallback } from 'react'
import { rhApi } from '../services/api'
import { onEvent, offEvent } from '../services/socket'
import { useUserStore } from '../stores/userStore'
import { toast } from '../stores/toastStore'

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
}

interface Props {
  active: boolean
}

export function AssetsPanel({ active }: Props) {
  const is_admin = useUserStore(s => s.is_admin)

  const [folders, setFolders] = useState<string[]>([])
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [viewUrl, setViewUrl] = useState<string | null>(null)

  const loadFolders = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await rhApi.listAssetFolders(undefined, signal)
      if (!signal?.aborted) setFolders(data.folders)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') { /* swallow */ }
    }
  }, [])

  const loadAssets = useCallback(async (directory: string | null, signal?: AbortSignal) => {
    try {
      const params = directory ? { directory } : undefined
      const data = await rhApi.listAssets(params, signal)
      if (!signal?.aborted) setAssets((data.items || []) as AssetItem[])
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') { /* swallow */ }
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const ctrl = new AbortController()
    void loadFolders(ctrl.signal)
    void loadAssets(activeFolder, ctrl.signal)
    return () => ctrl.abort()
  }, [active, activeFolder, loadFolders, loadAssets])

  useEffect(() => {
    if (!active) return
    const refresh = () => { void loadFolders(); void loadAssets(activeFolder) }
    onEvent('assets_update', refresh)
    return () => offEvent('assets_update', refresh)
  }, [active, activeFolder, loadAssets, loadFolders])

  const handleCreateFolder = async () => {
    const name = newFolderName.trim()
    if (!name) return
    const path = activeFolder ? `${activeFolder}/${name}` : name
    try {
      await rhApi.createAssetFolder(path)
      toast.success(`Folder "${name}" created`)
      setNewFolderName('')
      void loadFolders()
    } catch { toast.error('Failed to create folder') }
  }

  const handleDeleteFolder = async (folder: string) => {
    if (!confirm(`Delete folder "${folder}"? It must be empty.`)) return
    try {
      await rhApi.deleteAssetFolder(folder)
      toast.success('Folder deleted')
      if (activeFolder === folder) setActiveFolder(null)
      void loadFolders()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to delete') }
  }

  const handleStartRename = (folder: string) => {
    setRenamingFolder(folder)
    setRenameValue(folder.split('/').pop() || folder)
  }

  const handleRename = async () => {
    if (!renamingFolder || !renameValue.trim()) return
    try {
      const data = await rhApi.renameAssetFolder(renamingFolder, renameValue.trim())
      toast.success('Folder renamed')
      if (activeFolder === renamingFolder) setActiveFolder(data.new_path)
      setRenamingFolder(null)
      setRenameValue('')
      void loadFolders()
    } catch { toast.error('Failed to rename folder') }
  }

  const handleDeleteAsset = async (id: number) => {
    if (!confirm('Delete this asset?')) return
    try {
      await rhApi.deleteAsset(id)
      setAssets(prev => prev.filter(a => a.id !== id))
      toast.success('Asset deleted')
    } catch { toast.error('Failed to delete asset') }
  }

  if (!active) return null

  return (
    <div className="rh-assets-layout">
      <div className="rh-assets-sidebar">
        <div className="rh-assets-sidebar-header">Folders</div>
        <div
          className={`rh-assets-folder-row ${activeFolder === null ? 'rh-assets-folder-active' : ''}`}
          onClick={() => setActiveFolder(null)}
        >
          All Assets
        </div>
        {folders.map(folder => (
          <div
            key={folder}
            className={`rh-assets-folder-row ${activeFolder === folder ? 'rh-assets-folder-active' : ''}`}
          >
            {renamingFolder === folder ? (
              <input
                className="rh-assets-rename-input"
                value={renameValue}
                autoFocus
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleRename(); if (e.key === 'Escape') setRenamingFolder(null) }}
                onBlur={() => setRenamingFolder(null)}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className="rh-assets-folder-name" onClick={() => setActiveFolder(folder)}>{folder}</span>
            )}
            {is_admin && renamingFolder !== folder && (
              <span className="rh-assets-folder-actions">
                <button className="rh-assets-icon-btn" onClick={() => handleStartRename(folder)} title="Rename">&#9998;</button>
                <button className="rh-assets-icon-btn rh-assets-icon-danger" onClick={() => handleDeleteFolder(folder)} title="Delete">&#10005;</button>
              </span>
            )}
          </div>
        ))}
        {is_admin && (
          <div className="rh-assets-new-folder">
            <input
              className="rh-assets-new-folder-input"
              placeholder="New folder..."
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreateFolder() }}
            />
            <button className="rh-assets-create-btn" onClick={handleCreateFolder}>+</button>
          </div>
        )}
      </div>

      <div className="rh-assets-content">
        {assets.length === 0 ? (
          <div className="rh-assets-empty">
            {activeFolder ? `No assets in "${activeFolder}"` : 'No assets yet. Drop files into shared/Assets/'}
          </div>
        ) : (
          <div className="rh-assets-grid">
            {assets.map(asset => (
              <div key={asset.id} className="rh-asset-card" onClick={() => setViewUrl(asset.asset_url)}>
                <div className="rh-asset-thumb-wrap">
                  {asset.mime_type?.startsWith('video/') ? (
                    <div className="rh-asset-video-placeholder">Video</div>
                  ) : (
                    <img
                      src={asset.thumbnail_url || asset.asset_url}
                      alt={asset.filename}
                      className="rh-asset-thumb"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="rh-asset-info">
                  <span className="rh-asset-name" title={asset.filename}>{asset.filename}</span>
                  {asset.directory && <span className="rh-asset-dir">{asset.directory}</span>}
                  {is_admin && (
                    <button
                      className="rh-asset-delete-btn"
                      onClick={e => { e.stopPropagation(); void handleDeleteAsset(asset.id) }}
                    >&#10005;</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {viewUrl && (
        <>
          <div className="rh-assets-overlay" onClick={() => setViewUrl(null)} />
          <div className="rh-assets-viewer">
            <img src={viewUrl} alt="" className="rh-assets-viewer-img" />
            <button className="rh-assets-viewer-close" onClick={() => setViewUrl(null)}>&#10005;</button>
          </div>
        </>
      )}
    </div>
  )
}
