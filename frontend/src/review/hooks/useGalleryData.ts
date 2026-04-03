import { useEffect, useState, useCallback, useMemo } from 'react'
import { rhApi } from '../services/api'
import { onEvent, offEvent } from '../services/socket'
import { useSocketStore } from '../stores/socketStore'
import type { MediaCardMedia } from '../components/MediaCard'

export function useGalleryData(activeDirectory: string | null) {
  const [mediaList, setMediaList] = useState<MediaCardMedia[]>([])
  const [directories, setDirectories] = useState<{ name: string; count?: number }[]>([])
  const [subfolders, setSubfolders] = useState<{ name: string; path: string }[]>([])
  const mediaVersion = useSocketStore(s => s.mediaVersion)

  const loadMedia = useCallback(async () => {
    try {
      const params: Record<string, string> = {}
      if (activeDirectory) params.directory = activeDirectory
      const data = await rhApi.listMedia(params)
      setMediaList(data.items as MediaCardMedia[])
    } catch { /* swallow */ }
  }, [activeDirectory])

  const loadDirs = useCallback(async () => {
    try {
      const data = await rhApi.getDirectories()
      const all: string[] = (data.directories || []).filter(
        (d: any) => d != null && d !== '.'
      )
      const topLevel = all
        .filter((d) => !d.includes('/'))
        .map((d) => ({ name: d }))
      const subs = all
        .filter((d) => d.includes('/'))
        .map((d) => {
          const parts = d.split('/')
          return { name: parts[parts.length - 1], path: d }
        })
      setDirectories(topLevel)
      setSubfolders(subs)
    } catch { /* swallow */ }
  }, [])

  useEffect(() => {
    void loadMedia()
    void loadDirs()
  }, [loadMedia, loadDirs, mediaVersion])

  // Socket listeners for silent refresh
  useEffect(() => {
    const silentRefresh = () => void loadMedia()
    onEvent('media_update', silentRefresh)
    onEvent('favorite_toggle', silentRefresh)
    onEvent('comment_new', silentRefresh)
    return () => {
      offEvent('media_update', silentRefresh)
      offEvent('favorite_toggle', silentRefresh)
      offEvent('comment_new', silentRefresh)
    }
  }, [loadMedia])

  return { mediaList, directories, subfolders, loadMedia, loadDirs }
}

export function useFilteredMedia(
  mediaList: MediaCardMedia[],
  activeFilter: string,
  sortBy: string,
  search: string,
) {
  const filteredMedia = useMemo(() => {
    let list = [...mediaList]
    switch (activeFilter) {
      case 'favorites': list = list.filter(m => m.is_favorite); break
      case 'approved':  list = list.filter(m => m.status === 'approved'); break
      case 'rejected':  list = list.filter(m => m.status === 'rejected'); break
      case 'comments':  list = list.filter(m => (m.comment_count ?? 0) > 0); break
      case 'drawings':  list = list.filter(m => (m.drawing_count ?? 0) > 0); break
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m => m.filename.toLowerCase().includes(q))
    }
    switch (sortBy) {
      case 'newest':    list.sort((a, b) => b.id - a.id); break
      case 'oldest':    list.sort((a, b) => a.id - b.id); break
      case 'name_asc':  list.sort((a, b) => a.filename.localeCompare(b.filename)); break
      case 'name_desc': list.sort((a, b) => b.filename.localeCompare(a.filename)); break
    }
    return list
  }, [mediaList, activeFilter, sortBy, search])

  const stats = useMemo(() => ({
    total: filteredMedia.length,
    favorite_count: filteredMedia.filter(m => m.is_favorite).length,
    comment_count: filteredMedia.filter(m => (m.comment_count ?? 0) > 0).length,
  }), [filteredMedia])

  return { filteredMedia, stats }
}
