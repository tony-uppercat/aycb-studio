import { useRef } from 'react'
import { useDrawing } from '../hooks/useDrawing'

interface Props {
  mediaId: number
}

export function DrawingCanvas({ mediaId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  useDrawing(mediaId, containerRef)

  return <div ref={containerRef} className="rh-drawing-container" />
}
