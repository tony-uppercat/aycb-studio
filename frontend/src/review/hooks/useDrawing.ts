import { useEffect, useRef, useCallback, useState } from 'react'
import { Canvas as FabricCanvas, PencilBrush } from 'fabric'
import { socket } from '../services/socket'
import { rhApi } from '../services/api'
import { useDrawingToolStore } from '../stores/drawingToolStore'
import { useUserStore } from '../stores/userStore'

export function useDrawing(
  mediaId: number,
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const canvasRef = useRef<FabricCanvas | null>(null)
  const { tool, color, size } = useDrawingToolStore()
  const { userName } = useUserStore()
  const [undoStack, setUndoStack] = useState<string[]>([])

  // Init canvas
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const el = document.createElement('canvas')
    container.appendChild(el)
    const canvas = new FabricCanvas(el, {
      isDrawingMode: true,
      width: container.clientWidth,
      height: container.clientHeight,
      selection: false,
    })
    canvasRef.current = canvas

    // Load existing drawing
    rhApi
      .getDrawing(mediaId)
      .then((data) => {
        const record = data as { strokes_json?: string } | null
        if (record?.strokes_json) {
          return canvas.loadFromJSON(JSON.parse(record.strokes_json))
        }
      })
      .then(() => canvas.renderAll())
      .catch((e: unknown) => console.error('Failed to load drawing:', e))

    return () => {
      canvas.dispose()
      canvasRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId])

  // Update brush settings
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.isDrawingMode = true
    const brush = new PencilBrush(canvas)
    if (tool === 'eraser') {
      brush.color = '#000000'
      brush.width = size * 3
    } else {
      brush.color = color
      brush.width = size
    }
    canvas.freeDrawingBrush = brush
  }, [tool, color, size])

  // Record strokes + emit via socket
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onPathCreated = () => {
      const json = JSON.stringify(canvas.toJSON())
      setUndoStack((prev) => [...prev, json])
      socket.emit('drawing_stroke', { mediaId, json })
    }
    canvas.on('path:created', onPathCreated)
    return () => {
      canvas.off('path:created', onPathCreated)
    }
  }, [mediaId])

  // Listen for remote strokes
  useEffect(() => {
    const handleStroke = (data: { mediaId: number; json: string }) => {
      if (data.mediaId !== mediaId) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas
        .loadFromJSON(JSON.parse(data.json))
        .then(() => canvas.renderAll())
        .catch((e: unknown) => console.error('Remote stroke error:', e))
    }
    const handleClear = (data: { mediaId: number }) => {
      if (data.mediaId === mediaId) canvasRef.current?.clear()
    }
    const handleUndo = (data: { mediaId: number; json: string }) => {
      if (data.mediaId !== mediaId) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas
        .loadFromJSON(JSON.parse(data.json))
        .then(() => canvas.renderAll())
        .catch(() => {})
    }

    socket.on('drawing_stroke', handleStroke)
    socket.on('drawing_clear', handleClear)
    socket.on('drawing_undo', handleUndo)
    return () => {
      socket.off('drawing_stroke', handleStroke)
      socket.off('drawing_clear', handleClear)
      socket.off('drawing_undo', handleUndo)
    }
  }, [mediaId])

  const undo = useCallback(() => {
    if (undoStack.length < 2) {
      canvasRef.current?.clear()
      socket.emit('drawing_clear', { mediaId })
      return
    }
    const prev = undoStack[undoStack.length - 2]
    setUndoStack((s) => s.slice(0, -1))
    const canvas = canvasRef.current
    if (!canvas) return
    canvas
      .loadFromJSON(JSON.parse(prev))
      .then(() => canvas.renderAll())
      .catch(() => {})
    socket.emit('drawing_undo', { mediaId, json: prev })
  }, [undoStack, mediaId])

  const clear = useCallback(() => {
    canvasRef.current?.clear()
    setUndoStack([])
    socket.emit('drawing_clear', { mediaId })
  }, [mediaId])

  const save = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const json = JSON.stringify(canvas.toJSON())
    await rhApi.saveDrawing({
      media_id: mediaId,
      author: userName,
      strokes_json: json,
    })
  }, [mediaId, userName])

  return { undo, clear, save, canvasRef }
}
