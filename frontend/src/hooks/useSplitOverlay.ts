import { useCallback, useRef, useState } from 'react'
import { CANVAS_EVENTS } from '../events/canvasEvents'

const DRAG_THRESHOLD = 30 // px per step
const MIN_GRID = 1
const MAX_GRID = 6

interface UseSplitOverlayParams {
  mediaFile: React.MutableRefObject<File | null>
  nodeId: string
}

export interface UseSplitOverlayReturn {
  splitMode: boolean
  setSplitMode: React.Dispatch<React.SetStateAction<boolean>>
  splitCols: number
  setSplitCols: React.Dispatch<React.SetStateAction<number>>
  splitRows: number
  setSplitRows: React.Dispatch<React.SetStateAction<number>>
  executeSplit: (cols: number, rows: number) => void
  handlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  handlePointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
}

export function useSplitOverlay({
  mediaFile,
  nodeId,
}: UseSplitOverlayParams): UseSplitOverlayReturn {
  const [splitMode, setSplitMode] = useState(false)
  const [splitCols, setSplitCols] = useState(3)
  const [splitRows, setSplitRows] = useState(3)

  const dragOrigin = useRef<{ x: number; y: number; cols: number; rows: number } | null>(null)
  const didDrag = useRef(false)

  const executeSplit = useCallback((cols: number, rows: number) => {
    window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.IMAGE_SPLIT_GRID, {
      detail: { nodeId, cols, rows, file: mediaFile.current },
    }))
    setSplitMode(false)
  }, [nodeId, mediaFile])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    dragOrigin.current = { x: e.clientX, y: e.clientY, cols: splitCols, rows: splitRows }
    didDrag.current = false
  }, [splitCols, splitRows])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current) return
    e.stopPropagation()
    e.preventDefault()
    const dx = e.clientX - dragOrigin.current.x
    const dy = e.clientY - dragOrigin.current.y
    const colDelta = Math.round(dx / DRAG_THRESHOLD)
    const rowDelta = Math.round(dy / DRAG_THRESHOLD)
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) didDrag.current = true
    const newCols = Math.max(MIN_GRID, Math.min(MAX_GRID, dragOrigin.current.cols + colDelta))
    const newRows = Math.max(MIN_GRID, Math.min(MAX_GRID, dragOrigin.current.rows + rowDelta))
    setSplitCols(newCols)
    setSplitRows(newRows)
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    if (!didDrag.current) {
      executeSplit(splitCols, splitRows)
    }
    dragOrigin.current = null
  }, [executeSplit, splitCols, splitRows])

  return {
    splitMode,
    setSplitMode,
    splitCols,
    setSplitCols,
    splitRows,
    setSplitRows,
    executeSplit,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
