import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { useFileDrop } from '../../hooks/useFileDrop'
import { saveMediaForProject, loadMedia, generateMediaId } from '../../mediaStore'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { useCropOverlay } from '../../hooks/useCropOverlay'
import { useSplitOverlay } from '../../hooks/useSplitOverlay'
import type { ImageUploadNodeData } from '../../types'
import { useCanvasStore } from '../../stores/canvasStore'
import { CANVAS_EVENTS } from '../../events/canvasEvents'

export function useImageUpload(id: string, data: ImageUploadNodeData, selected?: boolean) {
  const { openPreview, isOpen: previewOpen } = useMediaPreview()
  const { updateNodeData } = useReactFlow()
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<File | null>(null)

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

    updateNodeData(id, { mediaId })
  }, [id, data, preview, updateNodeData])

  // Crop overlay hook
  const cropOverlay = useCropOverlay({ mediaFile: fileRef, nodeId: id, onFileChange: pickFile })

  // Split overlay hook
  const splitOverlay = useSplitOverlay({ mediaFile: fileRef, nodeId: id })

  // Load media from IndexedDB
  useEffect(() => {
    const mediaId = data.mediaId
    if (!mediaId) return
    let blobUrl: string | null = null
    loadMedia(mediaId).then(file => {
      if (file) {
        fileRef.current = file
        blobUrl = URL.createObjectURL(file)
        setPreview(blobUrl)
      }
    })
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [data.mediaId])

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

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

  const handleCtxDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setShowCtxMenu(false)
    window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.DUPLICATE_NODE, { detail: { nodeId: id } }))
  }, [id])

  // Close context menu on outside click
  useEffect(() => {
    if (!showCtxMenu) return
    function onDown() { setShowCtxMenu(false) }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [showCtxMenu])

  return {
    preview,
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
    handleCtxDuplicate,
    cropOverlay,
    splitOverlay,
    fileRef,
  }
}
