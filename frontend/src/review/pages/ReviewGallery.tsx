import { useEffect, useState, useCallback } from 'react'
import { rhApi } from '../services/api'
import { useSocketStore } from '../stores/socketStore'
import { MediaGrid } from '../components/MediaGrid'
import { FilterBar } from '../components/FilterBar'
import { FolderManager } from '../components/FolderManager'
import { Sidebar } from '../components/Sidebar'
import { Lightbox } from '../components/Lightbox'

interface MediaItem {
  id: number
  filename: string
  thumbnail_path?: string
  width?: number
  height?: number
  file_size?: number
}

export function ReviewGallery() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [directories, setDirectories] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [lightboxId, setLightboxId] = useState<number | null>(null)
  const [directory, setDirectory] = useState('')
  const [sort, setSort] = useState('created_at')
  const [order, setOrder] = useState('DESC')
  const [search, setSearch] = useState('')
  const mediaVersion = useSocketStore(s => s.mediaVersion)

  const loadMedia = useCallback(async () => {
    try {
      const params: Record<string, string> = {}
      if (directory) params.directory = directory
      if (sort) params.sort = sort
      if (order) params.order = order
      const data = await rhApi.listMedia(params)
      let filtered = data.items as MediaItem[]
      if (search) {
        const q = search.toLowerCase()
        filtered = filtered.filter(m => m.filename?.toLowerCase().includes(q))
      }
      setItems(filtered)
    } catch (e) {
      console.error('Failed to load media:', e)
    }
  }, [directory, sort, order, search])

  const loadDirs = useCallback(async () => {
    try {
      const data = await rhApi.getDirectories()
      setDirectories(data.directories || [])
    } catch (e) {
      console.error('Failed to load directories:', e)
    }
  }, [])

  useEffect(() => {
    void loadMedia()
    void loadDirs()
  }, [loadMedia, loadDirs, mediaVersion])

  const selected = selectedId != null ? items.find(m => m.id === selectedId) ?? null : null

  return (
    <div className="rh-gallery">
      <FilterBar
        sort={sort}
        order={order}
        search={search}
        onSortChange={setSort}
        onOrderChange={setOrder}
        onSearchChange={setSearch}
      />
      <div className="rh-gallery-body">
        <FolderManager directories={directories} current={directory} onChange={setDirectory} />
        <MediaGrid
          items={items}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDoubleClick={setLightboxId}
        />
        {selected && (
          <Sidebar media={selected} onClose={() => setSelectedId(null)} onRefresh={loadMedia} />
        )}
      </div>
      {lightboxId != null && (() => {
        const lbMedia = items.find((m) => m.id === lightboxId)
        if (!lbMedia) return null
        return (
          <Lightbox
            media={lbMedia}
            items={items}
            onClose={() => setLightboxId(null)}
            onNavigate={setLightboxId}
          />
        )
      })()}
    </div>
  )
}
