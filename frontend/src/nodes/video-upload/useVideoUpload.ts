import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useFileDrop } from '../../hooks/useFileDrop'
import { saveMediaForProject, loadMedia, generateMediaId } from '../../mediaStore'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { getVideoDuration } from '../../ffmpegUtil'
import type { VideoUploadNodeData } from '../../types'
import { useCanvasStore } from '../../stores/canvasStore'

const DEFAULT_FPS = 30

export function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.floor((s % 1) * 10)
  return `${m}:${sec.toString().padStart(2, '0')}.${ms}`
}

export function formatFrame(s: number): string {
  return `f${Math.round(s * DEFAULT_FPS)}`
}

function formatTimecode(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const frame = Math.round((s % 1) * DEFAULT_FPS)
  return `${String(m).padStart(2, '0')}m${String(sec).padStart(2, '0')}s${String(frame).padStart(2, '0')}f`
}

export function useVideoUpload(id: string, data: Record<string, unknown>, selected?: boolean) {
  const d = data as VideoUploadNodeData
  const { openPreview, isOpen: previewOpen } = useMediaPreview()
  const { updateNodeData, addNodes, getNode } = useReactFlow()
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Frame capture state
  const [frames, setFrames] = useState<string[]>([])
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [showFrames, setShowFrames] = useState(false)

  const fileRef = useRef<File | null>(null)

  // Refs for cleanup on unmount
  const videoUrlRef = useRef(videoUrl)
  videoUrlRef.current = videoUrl
  const framesRef = useRef(frames)
  framesRef.current = frames

  // Restore media and frames from IndexedDB on mount only
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true

    let videoBlobUrl: string | null = null
    const frameBlobUrls: string[] = []

    const mediaId = d.mediaId
    if (mediaId) {
      loadMedia(mediaId).then(file => {
        if (file) {
          fileRef.current = file
          videoBlobUrl = URL.createObjectURL(file)
          setVideoUrl(videoBlobUrl)
          getVideoDuration(file).then(dur => setDuration(dur)).catch(e => console.warn('[VideoUploadNode] getVideoDuration failed:', e.message ?? e))
        }
      })
    }
    const frameIds = d.frameIds
    if (frameIds?.length) {
      Promise.all(frameIds.map(fid => loadMedia(fid))).then(files => {
        const urls = files.filter(Boolean).map(f => {
          const url = URL.createObjectURL(f!)
          frameBlobUrls.push(url)
          return url
        })
        framesRef.current = urls
        setFrames(urls)
      })
    }

    return () => {
      if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl)
      frameBlobUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [d.mediaId, d.frameIds])

  const pickFile = useCallback(async (f: File) => {
    useCanvasStore.getState().snapshotCanvas?.()

    fileRef.current = f
    if (videoUrl?.startsWith('blob:')) URL.revokeObjectURL(videoUrl)
    setVideoUrl(URL.createObjectURL(f))
    setCurrentTime(0)
    frames.forEach(u => { if (u.startsWith('blob:')) URL.revokeObjectURL(u) })
    setFrames([])
    setStatusMsg(null)

    const dur = await getVideoDuration(f).catch(() => 0)
    setDuration(dur)

    const mediaId = d.mediaId || generateMediaId()
    await saveMediaForProject(mediaId, f)
    updateNodeData(id, { mediaId })
  }, [id, d, videoUrl, frames, updateNodeData])

  const fileDrop = useFileDrop('video/', pickFile)

  useEffect(() => {
    return () => {
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current)
      framesRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  // Shared capture logic
  const frameIdsRef = useRef(d.frameIds ?? [])
  frameIdsRef.current = d.frameIds ?? []

  const saveCapture = useCallback(async (blob: Blob, timecode: number) => {
    const baseName = fileRef.current?.name?.replace(/\.[^.]+$/, '') ?? 'video'
    const tc = formatTimecode(timecode)
    const frameName = `${baseName}_${tc}.jpg`
    const file = new File([blob], frameName, { type: 'image/jpeg' })
    const frameMediaId = generateMediaId()
    await saveMediaForProject(frameMediaId, file)

    const url = URL.createObjectURL(blob)
    setFrames(prev => [...prev, url])

    const ids = [...frameIdsRef.current, frameMediaId]
    updateNodeData(id, { frameIds: ids })
    setStatusMsg(`${ids.length} frame${ids.length > 1 ? 's' : ''}`)
  }, [id, updateNodeData])

  const handleClearFrames = useCallback((): void => {
    frames.forEach(u => { if (u.startsWith('blob:')) URL.revokeObjectURL(u) })
    setFrames([])
    updateNodeData(id, { frameIds: [] })
    setStatusMsg(null)
  }, [frames, id, updateNodeData])

  const handleImportFrames = useCallback(() => {
    const frameIds = frameIdsRef.current
    if (!frameIds.length) return
    const self = getNode(id)
    const baseX = (self?.position.x ?? 0) + 300
    const baseY = self?.position.y ?? 0

    const newNodes = frameIds.map((mediaId, i) => ({
      id: `${id}-import-${Date.now()}-${i}`,
      type: 'imageUpload' as const,
      position: { x: baseX + (i % 4) * 220, y: baseY + Math.floor(i / 4) * 250 },
      data: { mediaId } as Record<string, unknown>,
    }))
    addNodes(newNodes)
  }, [id, getNode, addNodes])

  const openFullscreen = useCallback(() => {
    if (videoUrl) openPreview(videoUrl, 'video', {
      onCapture: saveCapture,
      onClear: handleClearFrames,
      onImport: handleImportFrames,
      initialFrames: frames,
    })
  }, [videoUrl, openPreview, saveCapture, frames, handleClearFrames, handleImportFrames])

  // Spacebar -> fullscreen preview when node is selected
  useEffect(() => {
    if (!selected) return
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      if (previewOpen) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      openFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, previewOpen, openFullscreen])

  function togglePlay(): void {
    if (!videoRef.current) return
    if (videoRef.current.paused) { videoRef.current.play(); setPlaying(true) }
    else { videoRef.current.pause(); setPlaying(false) }
  }

  function handleTimeUpdate(): void {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
  }

  function handleLoadedMetadata(): void {
    if (videoRef.current) setDuration(videoRef.current.duration)
  }

  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleVideoClick(e: React.MouseEvent): void {
    e.stopPropagation()
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      openFullscreen()
      return
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null
      togglePlay()
    }, 250)
  }

  async function handleCaptureFrame(): Promise<void> {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.9))
    if (blob) await saveCapture(blob, videoRef.current!.currentTime)
  }

  const seekTo = useCallback((pct: number) => {
    const t = pct * (duration || 1)
    setCurrentTime(t)
    if (videoRef.current) videoRef.current.currentTime = t
  }, [duration])

  const stepFrame = useCallback((direction: number, shift: boolean) => {
    if (!videoRef.current || !duration) return
    const step = shift ? 1 : 1 / DEFAULT_FPS
    const t = Math.max(0, Math.min(duration, currentTime + direction * step))
    videoRef.current.currentTime = t
    setCurrentTime(t)
  }, [duration, currentTime])

  return {
    videoUrl, currentTime, duration, playing, videoRef,
    frames, statusMsg, showFrames, setShowFrames,
    fileDrop,
    togglePlay, handleTimeUpdate, handleLoadedMetadata,
    handleVideoClick, handleCaptureFrame,
    handleClearFrames, handleImportFrames,
    openFullscreen, openPreview,
    seekTo, stepFrame, setPlaying,
  }
}
