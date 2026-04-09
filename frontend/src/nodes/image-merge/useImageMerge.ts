import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow, useStore, useUpdateNodeInternals } from '@xyflow/react'
import type { SlotDef } from '../_shared/NodeShell'
import { useMediaPreview } from '../../components/media/MediaPreview'
import { saveMediaForProject, generateMediaId } from '../../mediaStore'
import { pullAllMedia } from '../../hooks/useDataPropagation'
import { reportNodeError } from '../../utils/nodeErrors'

const MAX_INPUTS = 8

export type LayoutMode = 'grid' | 'horizontal' | 'vertical'

export interface ImageMergeNodeData extends Record<string, unknown> {
  mediaId?: string
  layout?: string
  columns?: number
  gap?: number
  bgColor?: string
  outputMode?: string
  customW?: number
  customH?: number
  lockAspect?: boolean
  _stop?: boolean
}

/** Load a File as an HTMLImageElement */
function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

/**
 * Render images onto an OffscreenCanvas (or fallback regular canvas)
 * according to the chosen layout, then return a PNG Blob.
 */
async function renderCollage(
  images: HTMLImageElement[],
  layout: LayoutMode,
  columns: number,
  gap: number,
  bgColor: string,
  outputMode: string,
  customW: number,
  customH: number,
): Promise<Blob> {
  const count = images.length
  if (count === 0) throw new Error('No images to merge')

  let cols: number, rows: number
  if (layout === 'horizontal') {
    cols = count
    rows = 1
  } else if (layout === 'vertical') {
    cols = 1
    rows = count
  } else {
    cols = Math.min(columns, count)
    rows = Math.ceil(count / cols)
  }

  const maxImgW = Math.max(...images.map(img => img.naturalWidth))
  const maxImgH = Math.max(...images.map(img => img.naturalHeight))
  let canvasW: number, canvasH: number, cellW: number, cellH: number
  if (outputMode === 'custom' && customW > 0 && customH > 0) {
    canvasW = customW
    canvasH = customH
    cellW = (canvasW - (cols - 1) * gap) / cols
    cellH = (canvasH - (rows - 1) * gap) / rows
  } else if (outputMode === 'first' && images.length > 0) {
    const firstW = images[0].naturalWidth
    const firstH = images[0].naturalHeight
    cellW = firstW
    cellH = firstH
    canvasW = cols * cellW + (cols - 1) * gap
    canvasH = rows * cellH + (rows - 1) * gap
  } else {
    cellW = maxImgW
    cellH = maxImgH
    canvasW = cols * cellW + (cols - 1) * gap
    canvasH = rows * cellH + (rows - 1) * gap
  }

  canvasW = Math.min(Math.round(canvasW), 8192)
  canvasH = Math.min(Math.round(canvasH), 8192)
  cellW = (canvasW - (cols - 1) * gap) / cols
  cellH = (canvasH - (rows - 1) * gap) / rows

  let canvas: HTMLCanvasElement | OffscreenCanvas
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(canvasW, canvasH)
    ctx = canvas.getContext('2d')!
  } else {
    const el = document.createElement('canvas')
    el.width = canvasW
    el.height = canvasH
    canvas = el
    ctx = el.getContext('2d')!
  }

  if (bgColor === 'transparent') {
    ctx.clearRect(0, 0, canvasW, canvasH)
  } else {
    ctx.fillStyle = bgColor === 'white' ? '#ffffff' : '#000000'
    ctx.fillRect(0, 0, canvasW, canvasH)
  }

  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = col * (cellW + gap)
    const y = row * (cellH + gap)

    const img = images[i]
    const imgW = img.naturalWidth, imgH = img.naturalHeight
    const scale = Math.min(cellW / imgW, cellH / imgH)
    const drawW = imgW * scale, drawH = imgH * scale
    const drawX = x + (cellW - drawW) / 2
    const drawY = y + (cellH - drawH) / 2
    ctx.drawImage(img, drawX, drawY, drawW, drawH)
  }

  if (canvas instanceof OffscreenCanvas) {
    return await canvas.convertToBlob({ type: 'image/png' })
  } else {
    return new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
        'image/png',
      )
    })
  }
}

export function useImageMerge(id: string, data: ImageMergeNodeData) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const { openPreview } = useMediaPreview()

  // Dynamic image input pins
  const connectedImageCount = useStore(state =>
    state.edges.filter(e => e.target === id && (e.targetHandle ?? '').startsWith('image-')).length
  )
  const imageCount = Math.min(Math.max(connectedImageCount, 2), MAX_INPUTS)
  const imageSlots: SlotDef[] = Array.from({ length: imageCount }, (_, i) => ({
    id: `image-${i}`,
    label: `Image ${i + 1}`,
    type: 'image' as const,
  }))

  useEffect(() => {
    updateNodeInternals(id)
  }, [imageCount, id, updateNodeInternals])

  // Node state
  const [layout, setLayout] = useState<LayoutMode>((data.layout as LayoutMode) ?? 'grid')
  const [columns, setColumns] = useState(data.columns ?? 2)
  const [gap, setGap] = useState(data.gap ?? 4)
  const [bgColor, setBgColor] = useState(data.bgColor ?? 'black')
  const [outputMode, setOutputMode] = useState(data.outputMode ?? 'auto')
  const [customW, setCustomW] = useState(data.customW ?? 1024)
  const [customH, setCustomH] = useState(data.customH ?? 1024)
  const [lockAspect, setLockAspect] = useState(data.lockAspect ?? false)
  const aspectRatioRef = useRef(customW / customH)

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (data._stop) { setLoading(false); setError('') } }, [data._stop])

  const prevUrlRef = useRef<string | null>(null)
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
    }
  }, [])

  // Run handler
  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const files = await pullAllMedia(id, 'image-', getNodes, getEdges)
      if (files.length < 2) {
        setError('Connect at least 2 images')
        setLoading(false)
        return
      }

      const images = await Promise.all(files.map(f => fileToImage(f)))
      const blob = await renderCollage(
        images, layout, columns, gap, bgColor, outputMode, customW, customH,
      )

      const file = new File([blob], `collage_${Date.now()}.png`, { type: 'image/png' })
      const mediaId = generateMediaId()
      await saveMediaForProject(mediaId, file)
      updateNodeData(id, { mediaId })

      if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
      const url = URL.createObjectURL(blob)
      prevUrlRef.current = url
      setPreviewUrl(url)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      reportNodeError(id, msg)
    } finally {
      setLoading(false)
    }
  }, [id, getNodes, getEdges, updateNodeData, layout, columns, gap, bgColor, outputMode, customW, customH])

  return {
    // Dynamic slots
    imageSlots,
    connectedImageCount,
    // State
    layout, setLayout,
    columns, setColumns,
    gap, setGap,
    bgColor, setBgColor,
    outputMode, setOutputMode,
    customW, setCustomW,
    customH, setCustomH,
    lockAspect, setLockAspect,
    aspectRatioRef,
    previewUrl,
    loading,
    error,
    // Actions
    run,
    openPreview,
    updateNodeData,
  }
}
