/**
 * Crops an image File to the given normalized rectangle using the Canvas API.
 *
 * @param file  Source image File
 * @param crop  Rectangle in 0-1 normalized coordinates { x, y, w, h }
 * @returns     A new File containing the cropped region
 */
export async function cropImageFile(
  file: File,
  crop: { x: number; y: number; w: number; h: number },
): Promise<File> {
  const img = await loadImage(file);

  const sx = Math.round(img.naturalWidth * crop.x);
  const sy = Math.round(img.naturalHeight * crop.y);
  const sw = Math.round(img.naturalWidth * crop.w);
  const sh = Math.round(img.naturalHeight * crop.h);

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to obtain 2D canvas context');

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const blob = await canvasToBlob(canvas, file.type || 'image/png');
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const ext = file.type === 'image/jpeg' ? '.jpg' : '.png';
  return new File([blob], `cropped_${baseName}${ext}`, { type: blob.type });
}

/* ---------- helpers ---------- */

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };

    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const type = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('canvas.toBlob returned null'));
      }
    }, type, type === 'image/jpeg' ? 0.92 : undefined);
  });
}
