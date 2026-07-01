/**
 * Flip an image File horizontally or vertically by baking a mirrored copy on a
 * canvas. Used by the right-click "Flip" action on image nodes — produces a new
 * durable File so downstream nodes consume the mirrored pixels.
 */
export type FlipAxis = 'horizontal' | 'vertical'

/**
 * Canvas transform for a mirror flip: translate to the far edge, then negate
 * the axis scale so drawImage(0,0) lands the mirrored picture in-bounds. Pure —
 * the canvas glue in flipImageFile applies it.
 */
export function flipParams(axis: FlipAxis, width: number, height: number): {
  tx: number; ty: number; sx: number; sy: number
} {
  return axis === 'horizontal'
    ? { tx: width, ty: 0, sx: -1, sy: 1 }
    : { tx: 0, ty: height, sx: 1, sy: -1 }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Failed to decode source image'))
    el.src = url
  })
}

export async function flipImageFile(file: File, axis: FlipAxis): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    const { tx, ty, sx, sy } = flipParams(axis, canvas.width, canvas.height)
    ctx.translate(tx, ty)
    ctx.scale(sx, sy)
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Canvas toBlob returned null')
    return new File([blob], `flip_${axis[0]}_${Date.now()}.png`, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
