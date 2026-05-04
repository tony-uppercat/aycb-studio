import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore } from '@xyflow/react'
import { useFileDrop } from '../../hooks/useFileDrop'
import { saveMediaForProject, loadMedia, generateMediaId } from '../../mediaStore'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { useCropOverlay } from '../../hooks/useCropOverlay'
import { useSplitOverlay } from '../../hooks/useSplitOverlay'
import type { ImageUploadNodeData } from '../../types'
import { useCanvasStore } from '../../stores/canvasStore'
import { readPngTextChunks } from '../../utils/pngMeta'
import { saveMediaMeta } from '../../utils/reviewStatus'

export function useImageUpload(id: string, data: ImageUploadNodeData, selected?: boolean) {
  const { openPreview, isOpen: previewOpen } = useMediaPreview()
  const { updateNodeData } = useReactFlow()
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<File | null>(null)

  // Reactive input: when upstream pushes an image via image-in, read its mediaId
  const incomingMediaId = useStore(useCallback(state => {
    const edge = state.edges.find((e: { target: string; targetHandle?: string | null }) => e.target === id && e.targetHandle === 'image-in')
    if (!edge) return null
    const src = state.nodes.find((n: { id: string }) => n.id === edge.source)
    if (!src) return null
    const d = src.data as Record<string, unknown>
    const outputMediaIds = d.outputMediaIds as Record<string, string> | undefined
    if (outputMediaIds && edge.sourceHandle && edge.sourceHandle in outputMediaIds) {
      return outputMediaIds[edge.sourceHandle]
    }
    return (d.mediaId as string) ?? null
  }, [id]))

  const isProxy = !!incomingMediaId

  // Context menu state
  const [showCtxMenu, setShowCtxMenu] = useState(false)

  // File pick
  const pickFile = useCallback(async (f: File) => {
    useCanvasStore.getState().snapshotCanvas?.()

    fileRef.current = f
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
    const url = URL.createObjectURL(f)
    setPreview(url)

    const mediaId = data.mediaId || generateMediaId()
    await saveMediaForProject(mediaId, f)

    // Extract PNG tEXt metadata and persist to localStorage
    if (f.type === 'image/png' || f.name.endsWith('.png')) {
      readPngTextChunks(f).then(chunks => {
        if (Object.keys(chunks).length > 0) saveMediaMeta(mediaId, chunks)
      }).catch(() => { /* not a valid PNG */ })
    }

    updateNodeData(id, { mediaId })
  }, [id, data, preview, updateNodeData])

  // Crop overlay hook
  const cropOverlay = useCropOverlay({ mediaFile: fileRef, nodeId: id, onFileChange: pickFile })

  // Split overlay hook
  const splitOverlay = useSplitOverlay({ mediaFile: fileRef, nodeId: id })

  // Source of truth for the preview: upstream blob if proxy mode active,
  // otherwise the node's own media. Switches transparently on connect/disconnect.
  const previewMediaId = incomingMediaId ?? data.mediaId
  useEffect(() => {
    if (!previewMediaId) {
      setPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      fileRef.current = null
      return
    }
    let blobUrl: string | null = null
    let cancelled = false
    loadMedia(previewMediaId).then(file => {
      if (cancelled) return
      if (file) {
        fileRef.current = file
        blobUrl = URL.createObjectURL(file)
        setPreview(blobUrl)
      }
    })
    return () => {
      cancelled = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [previewMediaId])

  const { dragging, inputRef, dragHandlers, onInputChange, openPicker } =
    useFileDrop('image/', pickFile)

  // Fullscreen preview
  const uploadMediaId = (data.mediaId as string | undefined) ?? undefined

  const handlePreviewClick = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation()
    if (preview) openPreview(preview, 'image', { mediaId: uploadMediaId })
  }, [preview, openPreview, uploadMediaId])

  // Spacebar -> fullscreen preview when node is selected
  useEffect(() => {
    if (!selected) return
    function onKey(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      if (previewOpen) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      e.preventDefault()
      if (preview) openPreview(preview, 'image', { mediaId: uploadMediaId })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, preview, openPreview, previewOpen, uploadMediaId])

  // Context menu actions
  const handleCtxSplit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowCtxMenu(false)
    splitOverlay.setSplitMode(true)
  }, [splitOverlay])

  const handleCtxCrop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowCtxMenu(false)
    cropOverlay.setCropMode(true)
    cropOverlay.setCropRect({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })
    cropOverlay.setCropAspect(null)
  }, [cropOverlay])

  const handleCtxCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowCtxMenu(false)
    const file = fileRef.current
    if (!file) return
    try {
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' })
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    } catch {
      // clipboard write may fail in some browsers
    }
  }, [])

  // Close context menu on outside click
  useEffect(() => {
    if (!showCtxMenu) return
    function onDown() { setShowCtxMenu(false) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [showCtxMenu])

  // Proxy passthrough: when image-in is connected, mirror upstream via
  // outputMediaIds. Never touch data.mediaId — preserves the node's own
  // image so disconnect restores it.
  useEffect(() => {
    const currentOut = (data as { outputMediaIds?: Record<string, string> | null }).outputMediaIds
    if (incomingMediaId) {
      if (currentOut?.['image-out'] === incomingMediaId) return
      updateNodeData(id, { outputMediaIds: { 'image-out': incomingMediaId } })
    } else if (currentOut) {
      updateNodeData(id, { outputMediaIds: null })
    }
  }, [incomingMediaId]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    preview,
    isProxy,
    dragging,
    inputRef,
    dragHandlers,
    onInputChange,
    openPicker,
    showCtxMenu,
    setShowCtxMenu,
    handlePreviewClick,
    handleCtxSplit,
    handleCtxCrop,
    handleCtxCopy,
    cropOverlay,
    splitOverlay,
    fileRef,
  }
}
