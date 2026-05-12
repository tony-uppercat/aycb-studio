/**
 * Pure canvas helpers for the Image Merge node and the canvas
 * right-click "Merge" quick action. Decoupled from React/state so
 * both call sites share one renderer with no drift.
 */

export type LayoutMode = 'grid' | 'horizontal' | 'vertical'

export interface RenderImageMergeOptions {
  layout: LayoutMode
  columns: number
  gap: number
  /** 'black' | 'white' | 'transparent' */
  bgColor: string
  /** 'auto' | 'first' | 'custom' */
  outputMode: string
  customW: number
  customH: number
}

/** Load a File as an HTMLImageElement. Revokes its object URL on settle. */
export function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

/**
 * Render the supplied images onto an OffscreenCanvas (or DOM canvas
 * fallback) using the chosen layout, returning a PNG Blob.
 *
 * Each cell is letterboxed: images preserve aspect ratio and are
 * centered inside their cell.
 */
export async function renderImageMerge(
  images: HTMLImageElement[],
  opts: RenderImageMergeOptions,
): Promise<Blob> {
  const { layout, columns, gap, bgColor, outputMode, customW, customH } = opts
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
    cellW = images[0].naturalWidth
    cellH = images[0].naturalHeight
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
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      'image/png',
    )
  })
}

/**
 * Default columns for grid layout when the user picks "Merge → Grid"
 * from the right-click menu without configuring anything else. Picks a
 * roughly square arrangement: 2 → 2x1, 4 → 2x2, 9 → 3x3, etc.
 */
export function defaultGridColumns(count: number): number {
  if (count <= 1) return 1
  return Math.ceil(Math.sqrt(count))
}
