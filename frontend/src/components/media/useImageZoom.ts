/**
 * Image zoom + pan hook for FullscreenViewer.
 *
 * Wheel scrolls in/out (1×–8×), drag pans when zoom > 1, double-click resets,
 * keyboard `+`/`=`, `-`, `0` shortcuts mirror the wheel/double-click actions.
 *
 * Returns { style, cursor, handlers, reset } — drop the style + handlers onto
 * the <img> and call reset() whenever the displayed media changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_ZOOM = 1
const MAX_ZOOM = 8
const WHEEL_STEP = 1.15
const KEY_STEP = 1.25

export interface ImageZoomHandlers {
  onWheel: (e: React.WheelEvent<HTMLImageElement>) => void
  onMouseDown: (e: React.MouseEvent<HTMLImageElement>) => void
  onDoubleClick: () => void
}

export interface ImageZoomState {
  zoom: number
  pan: { x: number; y: number }
  style: React.CSSProperties
  handlers: ImageZoomHandlers
  reset: () => void
}

export function useImageZoom(): ImageZoomState {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanningRef = useRef(false)

  const reset = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const onWheel = useCallback((e: React.WheelEvent<HTMLImageElement>) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
    setZoom(z => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor))
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })
      return next
    })
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (zoom <= MIN_ZOOM) return
    isPanningRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const startPanX = pan.x
    const startPanY = pan.y
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      if (!isPanningRef.current) return
      setPan({
        x: startPanX + (ev.clientX - startX),
        y: startPanY + (ev.clientY - startY),
      })
    }
    const onUp = () => {
      isPanningRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [zoom, pan.x, pan.y])

  const onDoubleClick = useCallback(() => reset(), [reset])

  // Keyboard shortcuts: + / = zoom in, - zoom out, 0 reset.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setZoom(z => Math.min(MAX_ZOOM, z * KEY_STEP))
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setZoom(z => {
          const next = Math.max(MIN_ZOOM, z / KEY_STEP)
          if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })
          return next
        })
      } else if (e.key === '0') {
        e.preventDefault()
        reset()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [reset])

  const style: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    cursor: zoom > MIN_ZOOM ? 'grab' : 'default',
    transition: 'transform 60ms ease',
    willChange: zoom > MIN_ZOOM ? 'transform' : undefined,
  }

  return {
    zoom,
    pan,
    style,
    handlers: { onWheel, onMouseDown, onDoubleClick },
    reset,
  }
}
