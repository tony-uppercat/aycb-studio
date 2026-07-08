/**
 * Rotate an image File by 90/180/270 degrees clockwise by baking a rotated
 * copy on a canvas. Used by the right-click "Rotate" action on image nodes —
 * produces a new durable File so downstream nodes consume the rotated pixels.
 */
export type RotateAngle = 90 | 180 | 270

/**
 * Canvas transform for a clockwise rotation: output dimensions (swapped for
 * quarter turns), translate offset, and rotation in radians. Pure — the canvas
 * glue in rotateImageFile applies it.
 */
export function rotateParams(angle: RotateAngle, width: number, height: number): {
  width: number; height: number; tx: number; ty: number; rad: number
} {
  switch (angle) {
    case 90:
      return { width: height, height: width, tx: height, ty: 0, rad: Math.PI / 2 }
    case 180:
      return { width, height, tx: width, ty: height, rad: Math.PI }
    case 270:
      return { width: height, height: width, tx: 0, ty: width, rad: -Math.PI / 2 }
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('Failed to decode source image'))
    el.src = url
  })
}

export async function rotateImageFile(file: File, angle: RotateAngle): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const p = rotateParams(angle, img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = p.width
    canvas.height = p.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')
    ctx.translate(p.tx, p.ty)
    ctx.rotate(p.rad)
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Canvas toBlob returned null')
    return new File([blob], `rotate_${angle}_${Date.now()}.png`, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
