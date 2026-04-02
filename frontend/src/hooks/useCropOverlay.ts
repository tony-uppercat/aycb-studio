import { useCallback, useRef, useState } from 'react'
import { cropImageFile } from '../utils/cropImage'
import { CANVAS_EVENTS } from '../events/canvasEvents'

export type CropRect = { x: number; y: number; w: number; h: number }

export const ASPECT_PRESETS: { label: string; value: number | null }[] = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
]

export const HANDLE_IDS = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const
export type HandleId = (typeof HANDLE_IDS)[number]

const MIN_CROP = 0.05

interface CropDragState {
  handle: HandleId | 'move'
  startRect: CropRect
  startX: number
  startY: number
  containerW: number
  containerH: number
  cmd: boolean
  alt: boolean
}

interface UseCropOverlayParams {
  mediaFile: React.MutableRefObject<File | null>
  nodeId: string
  onFileChange: (f: File) => Promise<void>
}

export interface UseCropOverlayReturn {
  cropMode: boolean
  setCropMode: React.Dispatch<React.SetStateAction<boolean>>
  cropRect: CropRect
  setCropRect: React.Dispatch<React.SetStateAction<CropRect>>
  cropAspect: number | null
  setCropAspect: React.Dispatch<React.SetStateAction<number | null>>
  cropContainerRef: React.RefObject<HTMLDivElement | null>
  clampRect: (r: CropRect) => CropRect
  enforceAspect: (r: CropRect, aspect: number, containerW: number, containerH: number) => CropRect
  handlePos: (handle: HandleId, rect: CropRect) => { left: string; top: string }
  onCropPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onCropPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onCropPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  handleAspectSelect: (value: number | null) => void
  handleCropReplace: () => Promise<void>
  handleCropAsNew: () => Promise<void>
}

export function useCropOverlay({
  mediaFile,
  nodeId,
  onFileChange,
}: UseCropOverlayParams): UseCropOverlayReturn {
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })
  const [cropAspect, setCropAspect] = useState<number | null>(null)
  const cropDragRef = useRef<CropDragState | null>(null)
  const cropContainerRef = useRef<HTMLDivElement>(null)

  /** Clamp crop rect to [0,1] with min size */
  const clampRect = useCallback((r: CropRect): CropRect => {
    let { x, y, w, h } = r
    w = Math.max(MIN_CROP, Math.min(1, w))
    h = Math.max(MIN_CROP, Math.min(1, h))
    x = Math.max(0, Math.min(1 - w, x))
    y = Math.max(0, Math.min(1 - h, y))
    return { x, y, w, h }
  }, [])

  /** Enforce aspect ratio on a rect, keeping center stable */
  const enforceAspect = useCallback((
    r: CropRect,
    aspect: number,
    containerW: number,
    containerH: number,
  ): CropRect => {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2

    let w = r.w
    let h = (w * containerW) / (aspect * containerH)

    if (h > 1) {
      h = 1
      w = (h * aspect * containerH) / containerW
    }
    if (w > 1) {
      w = 1
      h = (w * containerW) / (aspect * containerH)
    }

    let x = cx - w / 2
    let y = cy - h / 2

    x = Math.max(0, Math.min(1 - w, x))
    y = Math.max(0, Math.min(1 - h, y))

    return { x, y, w: Math.max(MIN_CROP, w), h: Math.max(MIN_CROP, h) }
  }, [])

  /** Get handle position as {left%, top%} */
  const handlePos = useCallback((handle: HandleId, rect: CropRect): { left: string; top: string } => {
    const { x, y, w, h } = rect
    const positions: Record<HandleId, [number, number]> = {
      nw: [x, y],
      n: [x + w / 2, y],
      ne: [x + w, y],
      w: [x, y + h / 2],
      e: [x + w, y + h / 2],
      sw: [x, y + h],
      s: [x + w / 2, y + h],
      se: [x + w, y + h],
    }
    const [px, py] = positions[handle]
    return { left: `${px * 100}%`, top: `${py * 100}%` }
  }, [])

  /** Crop pointer down */
  const onCropPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const container = cropContainerRef.current
    if (!container) return

    e.stopPropagation()
    e.preventDefault()
    container.setPointerCapture(e.pointerId)

    const rect = container.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height

    const target = e.target as HTMLElement
    const handleAttr = target.getAttribute('data-handle') as HandleId | null

    let handle: HandleId | 'move' | null = null

    if (handleAttr && (HANDLE_IDS as readonly string[]).includes(handleAttr)) {
      handle = handleAttr as HandleId
    } else if (
      relX >= cropRect.x && relX <= cropRect.x + cropRect.w &&
      relY >= cropRect.y && relY <= cropRect.y + cropRect.h
    ) {
      handle = 'move'
    }

    if (!handle) return

    cropDragRef.current = {
      handle,
      startRect: { ...cropRect },
      startX: e.clientX,
      startY: e.clientY,
      containerW: rect.width,
      containerH: rect.height,
      cmd: e.metaKey || e.ctrlKey,
      alt: e.altKey,
    }
  }, [cropRect])

  /** Crop pointer move */
  const onCropPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = cropDragRef.current
    if (!drag) return

    e.stopPropagation()
    e.preventDefault()

    const dx = (e.clientX - drag.startX) / drag.containerW
    const dy = (e.clientY - drag.startY) / drag.containerH
    const { startRect, handle, alt } = drag
    const activeAspect = (e.metaKey || e.ctrlKey) ? cropAspect : null

    let next: CropRect

    if (handle === 'move') {
      next = clampRect({
        x: startRect.x + dx,
        y: startRect.y + dy,
        w: startRect.w,
        h: startRect.h,
      })
    } else {
      let { x, y, w, h } = startRect

      switch (handle) {
        case 'nw':
          x = startRect.x + dx
          y = startRect.y + dy
          w = startRect.w - dx
          h = startRect.h - dy
          break
        case 'n':
          y = startRect.y + dy
          h = startRect.h - dy
          break
        case 'ne':
          y = startRect.y + dy
          w = startRect.w + dx
          h = startRect.h - dy
          break
        case 'w':
          x = startRect.x + dx
          w = startRect.w - dx
          break
        case 'e':
          w = startRect.w + dx
          break
        case 'sw':
          x = startRect.x + dx
          w = startRect.w - dx
          h = startRect.h + dy
          break
        case 's':
          h = startRect.h + dy
          break
        case 'se':
          w = startRect.w + dx
          h = startRect.h + dy
          break
      }

      if (alt) {
        const cx = startRect.x + startRect.w / 2
        const cy = startRect.y + startRect.h / 2
        x = cx - w / 2
        y = cy - h / 2
      }

      next = clampRect({ x, y, w, h })

      if (activeAspect != null) {
        next = enforceAspect(next, activeAspect, drag.containerW, drag.containerH)
      }
    }

    setCropRect(next)
  }, [cropAspect, clampRect, enforceAspect])

  /** Crop pointer up */
  const onCropPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    cropDragRef.current = null
  }, [])

  /** Handle aspect ratio preset selection */
  const handleAspectSelect = useCallback((value: number | null) => {
    setCropAspect(value)
    if (value != null) {
      const container = cropContainerRef.current
      const cW = container?.clientWidth ?? 200
      const cH = container?.clientHeight ?? 200
      setCropRect(prev => enforceAspect(prev, value, cW, cH))
    }
  }, [enforceAspect])

  /** Crop Replace action */
  const handleCropReplace = useCallback(async () => {
    const file = mediaFile.current
    if (!file) return
    const cropped = await cropImageFile(file, cropRect)
    await onFileChange(cropped)
    setCropMode(false)
    setCropRect({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })
    setCropAspect(null)
  }, [cropRect, mediaFile, onFileChange])

  /** Crop As New action */
  const handleCropAsNew = useCallback(async () => {
    const file = mediaFile.current
    if (!file) return
    const cropped = await cropImageFile(file, cropRect)
    window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.IMAGE_CROP_AS_NEW, {
      detail: { sourceNodeId: nodeId, file: cropped },
    }))
    setCropMode(false)
    setCropRect({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })
    setCropAspect(null)
  }, [nodeId, cropRect, mediaFile])

  return {
    cropMode,
    setCropMode,
    cropRect,
    setCropRect,
    cropAspect,
    setCropAspect,
    cropContainerRef,
    clampRect,
    enforceAspect,
    handlePos,
    onCropPointerDown,
    onCropPointerMove,
    onCropPointerUp,
    handleAspectSelect,
    handleCropReplace,
    handleCropAsNew,
  }
}
