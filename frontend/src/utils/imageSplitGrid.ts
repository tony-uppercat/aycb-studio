/**
 * Splits an image File into a grid of tile Files using the Canvas API.
 *
 * Tiles are returned in row-major order (left to right, top to bottom).
 * Each tile is a PNG File named `{originalBaseName}_r{row}c{col}.png`.
 */
export async function splitImageToGrid(
  file: File,
  cols: number,
  rows: number,
): Promise<File[]> {
  const img = await loadImage(file);

  const tileW = Math.floor(img.naturalWidth / cols);
  const tileH = Math.floor(img.naturalHeight / rows);

  const baseName = file.name.replace(/\.[^.]+$/, '');
  const tiles: File[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const canvas = document.createElement('canvas');
      canvas.width = tileW;
      canvas.height = tileH;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to obtain 2D canvas context');
      }

      ctx.drawImage(
        img,
        /* source x */ c * tileW,
        /* source y */ r * tileH,
        /* source w */ tileW,
        /* source h */ tileH,
        /* dest   x */ 0,
        /* dest   y */ 0,
        /* dest   w */ tileW,
        /* dest   h */ tileH,
      );

      const blob = await canvasToBlob(canvas);
      const tileName = `${baseName}_r${r}c${c}.png`;
      tiles.push(new File([blob], tileName, { type: 'image/png' }));
    }
  }

  return tiles;
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

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('canvas.toBlob returned null'));
      }
    }, 'image/png');
  });
}
