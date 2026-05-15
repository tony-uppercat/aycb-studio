export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Pure geometry: compute a centered crop rectangle that matches the target
 * aspect ratio inside the source dimensions. Returns null when no crop is
 * needed (empty/invalid AR, invalid dims, or source already matches within
 * 0.001 ratio tolerance).
 */
export function computeCropRect(srcW: number, srcH: number, aspectRatio: string): CropRect | null {
  if (!aspectRatio) return null
  const parts = aspectRatio.split(':')
  if (parts.length !== 2) return null
  const arW = Number(parts[0])
  const arH = Number(parts[1])
  if (!arW || !arH || Number.isNaN(arW) || Number.isNaN(arH)) return null
  if (srcW <= 0 || srcH <= 0) return null

  const targetRatio = arW / arH
  const srcRatio = srcW / srcH
  if (Math.abs(srcRatio - targetRatio) < 0.001) return null

  let cropW: number
  let cropH: number
  if (srcRatio > targetRatio) {
    cropH = srcH
    cropW = Math.round(srcH * targetRatio)
  } else {
    cropW = srcW
    cropH = Math.round(srcW / targetRatio)
  }
  const x = Math.round((srcW - cropW) / 2)
  const y = Math.round((srcH - cropH) / 2)
  return { x, y, w: cropW, h: cropH }
}

/**
 * Pre-crop an image File to match the selected output aspect ratio. Returns
 * the original file when no crop is needed (empty AR, non-image MIME, exact
 * match) or when the browser environment cannot decode/encode the image.
 *
 * Used by the Generate Image node to enforce chain coherence: keep input
 * refs and output AR aligned so iterating on the same image does not drift.
 */
export async function cropImageFileToAspectRatio(file: File, aspectRatio: string): Promise<File> {
  if (!aspectRatio) return file
  if (!file.type.startsWith('image/')) return file

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => resolve(null)
      i.src = url
    })
    if (!img) return file

    const rect = computeCropRect(img.naturalWidth, img.naturalHeight, aspectRatio)
    if (!rect) return file

    const canvas = document.createElement('canvas')
    canvas.width = rect.w
    canvas.height = rect.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, file.type, 0.95),
    )
    if (!blob) return file
    return new File([blob], file.name, { type: file.type })
  } finally {
    URL.revokeObjectURL(url)
  }
}
