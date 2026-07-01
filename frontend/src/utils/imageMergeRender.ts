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

/**
 * Per-dimension canvas cap (browser limit) and total-area cap (memory
 * safety). Raised from the old 8192 per-dim so merges of large inputs
 * (e.g. two 8K images, or 3+ 4K images) keep the largest input at its
 * native resolution instead of being silently downscaled.
 */
export const MAX_CANVAS_DIM = 16384
export const MAX_CANVAS_AREA = 16384 * 8192 // ~134M px (~512MB) ceiling

export interface MergeLayout {
  cols: number
  rows: number
  canvasW: number
  canvasH: number
  cellW: number
  cellH: number
}

/**
 * Pure sizing math for a merge: given each input's intrinsic dimensions
 * and the layout options, compute the output canvas + per-cell size.
 *
 * 'auto' sizes cells to the largest input (max width × max height) so the
 * biggest image is never downscaled. The canvas is then bounded: first to
 * MAX_CANVAS_DIM per side, then to MAX_CANVAS_AREA total — both via a
 * single proportional scale so the aspect ratio is preserved.
 */
export function computeMergeLayout(
  dims: Array<{ w: number; h: number }>,
  opts: { layout: LayoutMode; columns: number; gap: number; outputMode: string; customW: number; customH: number },
): MergeLayout {
  const { layout, columns, gap, outputMode, customW, customH } = opts
  const count = dims.length
  if (count === 0) return { cols: 0, rows: 0, canvasW: 0, canvasH: 0, cellW: 0, cellH: 0 }

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

  const maxImgW = Math.max(...dims.map(d => d.w))
  const maxImgH = Math.max(...dims.map(d => d.h))
  let canvasW: number, canvasH: number, cellW: number, cellH: number
  if (outputMode === 'custom' && customW > 0 && customH > 0) {
    canvasW = customW
    canvasH = customH
    cellW = (canvasW - (cols - 1) * gap) / cols
    cellH = (canvasH - (rows - 1) * gap) / rows
  } else if (outputMode === 'first') {
    cellW = dims[0].w
    cellH = dims[0].h
    canvasW = cols * cellW + (cols - 1) * gap
    canvasH = rows * cellH + (rows - 1) * gap
  } else {
    // 'auto' (default): adapt to the largest input so nothing is downscaled.
    cellW = maxImgW
    cellH = maxImgH
    canvasW = cols * cellW + (cols - 1) * gap
    canvasH = rows * cellH + (rows - 1) * gap
  }

  canvasW = Math.round(canvasW)
  canvasH = Math.round(canvasH)
  // Single proportional scale that satisfies both the per-side and the
  // total-area caps at once (keeps the merged aspect ratio intact).
  let scale = Math.min(1, MAX_CANVAS_DIM / canvasW, MAX_CANVAS_DIM / canvasH)
  const area = (canvasW * scale) * (canvasH * scale)
  if (area > MAX_CANVAS_AREA) scale *= Math.sqrt(MAX_CANVAS_AREA / area)
  canvasW = Math.max(1, Math.round(canvasW * scale))
  canvasH = Math.max(1, Math.round(canvasH * scale))
  cellW = (canvasW - (cols - 1) * gap) / cols
  cellH = (canvasH - (rows - 1) * gap) / rows
  return { cols, rows, canvasW, canvasH, cellW, cellH }
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

  const { cols, canvasW, canvasH, cellW, cellH } = computeMergeLayout(
    images.map(img => ({ w: img.naturalWidth, h: img.naturalHeight })),
    { layout, columns, gap, outputMode, customW, customH },
  )

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
