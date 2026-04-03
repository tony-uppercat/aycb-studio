import { useEffect, useCallback } from 'react'
import { DrawingCanvas } from './DrawingCanvas'
import { DrawingToolbar } from './DrawingToolbar'

interface MediaItem {
  id: number
  filename: string
  filepath?: string
}

interface Props {
  media: MediaItem
  items: MediaItem[]
  onClose: () => void
  onNavigate: (id: number) => void
}

export function Lightbox({ media, items, onClose, onNavigate }: Props) {
  const currentIndex = items.findIndex((m) => m.id === media.id)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && currentIndex > 0)
        onNavigate(items[currentIndex - 1].id)
      if (e.key === 'ArrowRight' && currentIndex < items.length - 1)
        onNavigate(items[currentIndex + 1].id)
    },
    [currentIndex, items, onClose, onNavigate],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  const imgSrc = `/media/${media.filepath?.split('/').pop() ?? media.filename}`

  return (
    <div className="rh-lightbox-overlay" onClick={onClose}>
      <div
        className="rh-lightbox-content"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="rh-lightbox-close" onClick={onClose}>
          &times;
        </button>
        <div className="rh-lightbox-counter">
          {currentIndex + 1} / {items.length}
        </div>
        <div className="rh-lightbox-image-wrap">
          <img
            src={imgSrc}
            alt={media.filename}
            className="rh-lightbox-img"
          />
          <DrawingCanvas mediaId={media.id} />
        </div>
        <DrawingToolbar />
      </div>
    </div>
  )
}
