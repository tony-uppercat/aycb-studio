import { useRef, useState } from 'react'
import { loadMedia } from '../mediaStore'

type MimePrefix = 'image/' | 'video/'

interface FileDropResult {
  dragging: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  dragHandlers: {
    onDragEnter: (e: React.DragEvent) => void
    onDragOver: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  openPicker: () => void
}

export function useFileDrop(
  mimePrefix: MimePrefix,
  onFile: (file: File) => void,
): FileDropResult {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  function handleDragEnter(e: React.DragEvent): void {
    e.preventDefault()
    dragCounter.current++
    setDragging(true)
  }

  function handleDragOver(e: React.DragEvent): void {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function handleDragLeave(e: React.DragEvent): void {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setDragging(false)
  }

  function handleDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation() // prevent canvas from creating a duplicate node
    dragCounter.current = 0
    setDragging(false)

    // Handle MediaBrowser drag (custom MIME type with mediaId)
    const mediaData = e.dataTransfer.getData('application/x-aycb-media')
    if (mediaData) {
      try {
        const items: Array<{ mediaId: string; type: string; name: string }> = JSON.parse(mediaData)
        const item = items[0]
        if (item && item.type.startsWith(mimePrefix)) {
          loadMedia(item.mediaId).then(file => {
            if (file) onFile(file)
          }).catch(console.error)
        }
      } catch { /* ignore parse errors */ }
      return
    }

    // Handle external file drop
    const f = e.dataTransfer.files?.[0]
    if (f?.type.startsWith(mimePrefix)) onFile(f)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (f) onFile(f)
  }

  function openPicker(): void {
    inputRef.current?.click()
  }

  return {
    dragging,
    inputRef,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
    onInputChange,
    openPicker,
  }
}
