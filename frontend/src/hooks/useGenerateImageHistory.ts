import { useCallback, useEffect, useRef, useState } from 'react'
import { loadMedia } from '../mediaStore'

interface UseGenerateImageHistoryParams {
  nodeId: string
  historyIdsFromData: string[]
}

interface UseGenerateImageHistoryResult {
  historyIds: string[]
  historyIndex: number
  historyPreview: string | null
  historyThumbs: (string | null)[]
  historyExpanded: boolean
  navigateHistory: (dir: 1 | -1) => void
  setHistoryIds: React.Dispatch<React.SetStateAction<string[]>>
  setHistoryIndex: React.Dispatch<React.SetStateAction<number>>
  setHistoryExpanded: React.Dispatch<React.SetStateAction<boolean>>
  userNavigatedRef: React.MutableRefObject<boolean>
}

export function useGenerateImageHistory(params: UseGenerateImageHistoryParams): UseGenerateImageHistoryResult {
  const { historyIdsFromData } = params
  // historyIds mirrors the data prop but lives in state so effects can depend on it
  const [historyIds, setHistoryIdsRaw] = useState<string[]>(historyIdsFromData)
  const [historyIndex, setHistoryIndex] = useState(historyIdsFromData.length ? historyIdsFromData.length - 1 : -1)

  // Sync from external data changes (undo/redo, project switch)
  const dataKey = historyIdsFromData.join(',')
  const [prevDataKey, setPrevDataKey] = useState(dataKey)
  if (prevDataKey !== dataKey) {
    setPrevDataKey(dataKey)
    setHistoryIdsRaw(historyIdsFromData)
    setHistoryIndex(historyIdsFromData.length ? historyIdsFromData.length - 1 : -1)
  }
  const [historyPreview, setHistoryPreview] = useState<string | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [historyThumbs, setHistoryThumbs] = useState<(string | null)[]>([])
  const userNavigatedRef = useRef(false)

  // Load all thumbnails when history panel is expanded
  useEffect(() => {
    if (!historyExpanded || !historyIds.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistoryThumbs([])
      return
    }
    let cancelled = false
    Promise.all(historyIds.map(mid => loadMedia(mid))).then(files => {
      if (cancelled) return
      setHistoryThumbs(files.map(f => f ? URL.createObjectURL(f) : null))
    })
    return () => {
      cancelled = true
      setHistoryThumbs(prev => {
        prev.forEach(u => { if (u?.startsWith('blob:')) URL.revokeObjectURL(u) })
        return []
      })
    }
  }, [historyExpanded, historyIds.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  // Load history image when index changes
  useEffect(() => {
    if (historyIndex < 0 || !historyIds[historyIndex]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistoryPreview(null)
      return
    }
    let cancelled = false
    loadMedia(historyIds[historyIndex]).then(file => {
      if (cancelled || !file) return
      const url = URL.createObjectURL(file)
      setHistoryPreview(prev => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
        return url
      })
    })
    return () => {
      cancelled = true
      // Keep old preview visible until new one loads — avoids flicker.
      // Old blob URL is revoked when new one arrives (in the setter above).
    }
  }, [historyIndex, historyIds.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  // Wrap setHistoryIds to auto-advance historyIndex to the newest item
  const setHistoryIds: React.Dispatch<React.SetStateAction<string[]>> = useCallback((action) => {
    setHistoryIdsRaw(prev => {
      const next = typeof action === 'function' ? action(prev) : action
      if (next.length > 0) setHistoryIndex(next.length - 1)
      return next
    })
  }, [])

  const navigateHistory = useCallback((dir: 1 | -1) => {
    userNavigatedRef.current = true
    setHistoryIndex(i => {
      if (dir === -1) return Math.max(0, i - 1)
      return Math.min(historyIds.length - 1, i + 1)
    })
  }, [historyIds.length])

  return {
    historyIds,
    historyIndex,
    historyPreview,
    historyThumbs,
    historyExpanded,
    navigateHistory,
    setHistoryIds,
    setHistoryIndex,
    setHistoryExpanded,
    userNavigatedRef,
  }
}
