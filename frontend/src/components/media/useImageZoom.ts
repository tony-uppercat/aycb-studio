/**
 * Image zoom + pan hook for FullscreenViewer.
 *
 * Wheel zooms in/out, drag pans when zoom > 1, double-click resets,
 * keyboard `+`/`=`, `-`, `0` mirror those actions. Press `1` to snap to
 * true 1:1 pixel mapping (only meaningful when natural+displayed dims are
 * provided).
 *
 * Returns { zoom, realPercent, ... }. `zoom` is the internal CSS scale
 * factor; `realPercent` is the actual visible-vs-natural pixel ratio
 * (e.g. 100 = each natural pixel maps to one screen pixel). Without
 * natural+displayed dims, `realPercent` is null and the badge in the
 * caller falls back to showing the raw zoom %.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const MIN_ZOOM = 1
const DEFAULT_MAX_ZOOM = 8
const WHEEL_STEP = 1.15
const KEY_STEP = 1.25

export interface ImageZoomHandlers {
  onWheel: (e: React.WheelEvent<HTMLImageElement>) => void
  onMouseDown: (e: React.MouseEvent<HTMLImageElement>) => void
  onDoubleClick: () => void
}

export interface ImageZoomOptions {
  /** Natural pixel dimensions of the source image. */
  naturalDims?: { w: number; h: number } | null
  /** Currently rendered width in CSS px of the <img>. */
  displayedWidth?: number | null
}

export interface ImageZoomState {
  zoom: number
  /** Real pixel ratio in %: 100 = one natural pixel per screen pixel. Null when dims unknown. */
  realPercent: number | null
  /** True scale factor that yields realPercent=100 (i.e. 1:1). Null when dims unknown. */
  zoom1to1: number | null
  /** Whether we currently sit close enough to 1:1 to display "100%". */
  atOneToOne: boolean
  pan: { x: number; y: number }
  style: React.CSSProperties
  handlers: ImageZoomHandlers
  reset: () => void
  /** Snap to true 1:1 pixel mapping. No-op when dims unknown. */
  snapToOneToOne: () => void
}

export function useImageZoom(options: ImageZoomOptions = {}): ImageZoomState {
  const { naturalDims, displayedWidth } = options
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanningRef = useRef(false)

  // fitScale = displayedWidth / naturalWidth — how much the browser is
  // already shrinking the image to fit. zoom1to1 = 1/fitScale is the CSS
  // scale that re-inflates to the natural resolution.
  const fitScale = (naturalDims && displayedWidth && displayedWidth > 0 && naturalDims.w > 0)
    ? displayedWidth / naturalDims.w
    : null
  const zoom1to1 = fitScale ? 1 / fitScale : null

  // realPercent = (rendered px / natural px) × 100. At zoom=1 it equals
  // fitScale×100 (the browser's contain-fit ratio).
  const realPercent = fitScale != null ? Math.round(zoom * fitScale * 100) : null
  const atOneToOne = realPercent != null && Math.abs(realPercent - 100) < 1

  // MAX_ZOOM is bumped so the user can actually reach (and pass) 1:1 on
  // high-res images. Without this, MAX=8 caps below 1:1 for anything
  // larger than 8× the viewport width.
  const maxZoom = zoom1to1
    ? Math.max(DEFAULT_MAX_ZOOM, zoom1to1 * 1.5)
    : DEFAULT_MAX_ZOOM

  const reset = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const snapToOneToOne = useCallback(() => {
    if (zoom1to1 == null) return
    setZoom(Math.min(zoom1to1, maxZoom))
  }, [zoom1to1, maxZoom])

  const onWheel = useCallback((e: React.WheelEvent<HTMLImageElement>) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
    setZoom(z => {
      const next = Math.max(MIN_ZOOM, Math.min(maxZoom, z * factor))
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 })
      return next
    })
  }, [maxZoom])

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

  // Keyboard shortcuts: + / = zoom in, - zoom out, 0 reset, 1 snap to 1:1.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        setZoom(z => Math.min(maxZoom, z * KEY_STEP))
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
      } else if (e.key === '1') {
        e.preventDefault()
        snapToOneToOne()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [reset, snapToOneToOne, maxZoom])

  const style: React.CSSProperties = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    cursor: zoom > MIN_ZOOM ? 'grab' : 'default',
    transition: 'transform 60ms ease',
    willChange: zoom > MIN_ZOOM ? 'transform' : undefined,
    // Pixel-perfect rendering when we're at or above 1:1 — avoids the
    // smoothing blur that browsers apply on upscale.
    imageRendering: atOneToOne || (realPercent != null && realPercent > 100) ? 'pixelated' : undefined,
  }

  return {
    zoom,
    realPercent,
    zoom1to1,
    atOneToOne,
    pan,
    style,
    handlers: { onWheel, onMouseDown, onDoubleClick },
    reset,
    snapToOneToOne,
  }
}
