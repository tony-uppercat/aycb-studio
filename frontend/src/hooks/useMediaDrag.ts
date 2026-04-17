import { useCallback, useRef } from 'react'
import { type MediaEntry, saveMediaForProject, generateMediaId } from '../mediaStore'

interface ReferenceItem {
  id: number
  filename: string
}

interface UseMediaDragOptions {
  thumbs: Map<string, string>
  selected: Set<string>
  entries: MediaEntry[]
  onClose: () => void
}

export function useMediaDrag({ thumbs, selected, entries, onClose }: UseMediaDragOptions) {
  const closeOnDragRef = useRef(false)

  const closePanelAfterDrag = useCallback(() => {
    closeOnDragRef.current = true
    requestAnimationFrame(() => {
      if (closeOnDragRef.current) {
        closeOnDragRef.current = false
        onClose()
      }
    })
  }, [onClose])

  const handleDragStart = useCallback((entry: MediaEntry, e: React.DragEvent) => {
    const payload = JSON.stringify([{
      mediaId: entry.id,
      type: entry.type,
      name: entry.name,
    }])
    e.dataTransfer.setData('application/x-aycb-media', payload)
    e.dataTransfer.effectAllowed = 'copy'

    const thumb = thumbs.get(entry.id)
    if (thumb) {
      const img = new Image()
      img.src = thumb
      const size = 80
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.drawImage(img, 0, 0, size, size)
      canvas.style.position = 'fixed'
      canvas.style.left = '-9999px'
      document.body.appendChild(canvas)
      e.dataTransfer.setDragImage(canvas, size / 2, size / 2)
      requestAnimationFrame(() => canvas.remove())
    }

    closePanelAfterDrag()
  }, [thumbs, closePanelAfterDrag])

  const handleDragStartMulti = useCallback((e: React.DragEvent) => {
    const ids = [...selected]
    if (ids.length === 0) return
    const items = entries
      .filter(entry => ids.includes(entry.id))
      .map(entry => ({
        mediaId: entry.id,
        type: entry.type,
        name: entry.name,
      }))
    e.dataTransfer.setData('application/x-aycb-media', JSON.stringify(items))
    e.dataTransfer.effectAllowed = 'copy'
    closePanelAfterDrag()
  }, [selected, entries, closePanelAfterDrag])

  const handleRefDragStart = useCallback((ref: ReferenceItem, e: React.DragEvent) => {
    const mediaId = generateMediaId()

    fetch(`/api/bridge/references/${ref.id}/image`)
      .then(r => r.blob())
      .then(blob => {
        const mimeType = blob.type || 'image/png'
        const ext = mimeType.split('/')[1] ?? 'png'
        const file = new File([blob], ref.filename || `ref-${ref.id}.${ext}`, { type: mimeType })
        return saveMediaForProject(mediaId, file)
      })
      .catch(err => console.warn('[AYCB] Ref drag save failed:', err))

    const payload = JSON.stringify([{
      mediaId,
      type: 'image/png',
      name: ref.filename,
    }])
    e.dataTransfer.setData('application/x-aycb-media', payload)
    e.dataTransfer.effectAllowed = 'copy'
    closePanelAfterDrag()
  }, [closePanelAfterDrag])

  const handleDragEnd = useCallback(() => {
    closeOnDragRef.current = false
  }, [])

  return { handleDragStart, handleDragStartMulti, handleRefDragStart, handleDragEnd, closePanelAfterDrag }
}
