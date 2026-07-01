import { useEffect, useState, useCallback, useMemo } from 'react'
import { rhApi } from '../services/api'
import { onEvent, offEvent } from '../services/socket'
import { useSocketStore } from '../stores/socketStore'
import type { MediaCardMedia } from '../components/MediaCard'

// Pull the generation prompt out of the metadata JSON blob (scanner stores it
// under the top-level `prompt` key). Returns '' when absent or unparseable.
function promptOf(metadata?: string): string {
  if (!metadata) return ''
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return typeof m?.prompt === 'string' ? m.prompt : ''
  } catch {
    return ''
  }
}

export function useGalleryData(activeDirectory: string | null) {
  const [mediaList, setMediaList] = useState<MediaCardMedia[]>([])
  const [directories, setDirectories] = useState<{ name: string; count?: number }[]>([])
  const [subfolders, setSubfolders] = useState<{ name: string; path: string }[]>([])
  const mediaVersion = useSocketStore(s => s.mediaVersion)

  const loadMedia = useCallback(async (signal?: AbortSignal) => {
    try {
      const params: Record<string, string> = {}
      if (activeDirectory) params.directory = activeDirectory
      const data = await rhApi.listMedia(params, signal)
      if (!signal?.aborted) setMediaList(data.items as MediaCardMedia[])
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') { /* swallow */ }
    }
  }, [activeDirectory])

  const loadDirs = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await rhApi.getDirectories(signal)
      if (signal?.aborted) return
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
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') { /* swallow */ }
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void loadMedia(ctrl.signal)
    void loadDirs(ctrl.signal)
    return () => { ctrl.abort() }
  }, [loadMedia, loadDirs, mediaVersion])

  // Socket listeners for silent refresh. Debounced at 500ms so a burst
  // of comment/favorite events from multiple users coalesces into one
  // refetch instead of hammering /api/rh/media N times per burst.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null
    const silentRefresh = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        pending = null
        void loadMedia()
      }, 500)
    }
    onEvent('media_update', silentRefresh)
    onEvent('favorite_toggle', silentRefresh)
    onEvent('comment_new', silentRefresh)
    return () => {
      if (pending) clearTimeout(pending)
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
      list = list.filter(m =>
        m.filename.toLowerCase().includes(q) ||
        promptOf(m.metadata).toLowerCase().includes(q)
      )
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
