/**
 * Unified download manager for AYCB.
 *
 * Centralizes all browser download logic:
 * - triggerDownload: core primitive, handles blob/URL/base64 sources
 * - downloadFile: download a File/Blob with proper cleanup
 * - downloadFromUrl: download from a URL (blob: or http)
 * - downloadJSON: serialize and download JSON data
 * - downloadBatch: download multiple files sequentially
 *
 * All download points in the app should go through these functions
 * instead of manually creating <a> elements.
 */

// ── Core primitive ──────────────────────────────────────────────────────────

export interface DownloadOptions {
  /** Override filename (otherwise inferred from source). */
  filename?: string
  /** MIME type hint for blob creation. */
  mimeType?: string
}

/**
 * Trigger a browser file download from a Blob.
 * Handles object URL creation and cleanup.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  // Cleanup after a short delay to ensure download starts
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 200)
}

// ── File download ───────────────────────────────────────────────────────────

/**
 * Download a File or Blob object.
 * Uses the file's name if no filename override is provided.
 */
export function downloadFile(file: File | Blob, opts?: DownloadOptions): void {
  const name = opts?.filename
    ?? (file instanceof File ? file.name : null)
    ?? `download_${Date.now()}`
  triggerDownload(file, name)
}

// ── URL download ────────────────────────────────────────────────────────────

/**
 * Download from a URL string (works with blob: URLs and http/https URLs).
 * For blob URLs, triggers download directly.
 * For remote URLs, a simple <a download> is used (browser handles the rest).
 */
export function downloadFromUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
  }, 200)
}

// ── JSON download ───────────────────────────────────────────────────────────

/**
 * Serialize data as JSON and download it.
 */
export function downloadJSON(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  triggerDownload(blob, filename)
}

// ── Batch download ──────────────────────────────────────────────────────────

export interface BatchItem {
  blob: Blob
  filename: string
}

/**
 * Download multiple files sequentially.
 * Calls onProgress(completed, total) after each file.
 * Returns the number of files successfully triggered.
 */
export async function downloadBatch(
  items: BatchItem[],
  onProgress?: (completed: number, total: number) => void,
): Promise<number> {
  let completed = 0
  for (const item of items) {
    triggerDownload(item.blob, item.filename)
    completed++
    onProgress?.(completed, items.length)
    // Small delay between downloads to avoid browser throttling
    if (completed < items.length) {
      await new Promise(r => setTimeout(r, 100))
    }
  }
  return completed
}

// ── Filename helpers ────────────────────────────────────────────────────────

/**
 * Generate a standardized filename for AYCB downloads.
 * Pattern: aycb_{type}_{timestamp}.{ext}
 */
export function makeFilename(
  type: 'image' | 'video' | 'capture' | 'report' | 'costs' | 'project' | 'nodes',
  ext: string,
  suffix?: string,
): string {
  const ts = Date.now()
  const parts = ['aycb', type]
  if (suffix) parts.push(suffix)
  parts.push(String(ts))
  return `${parts.join('_')}.${ext}`
}

/**
 * Generate a capture filename from timecode.
 * Pattern: capture_MMmSSsFFf.jpg
 */
export function makeCaptureFilename(timecode: number, fps = 30): string {
  const m = Math.floor(timecode / 60)
  const sec = Math.floor(timecode % 60)
  const fr = Math.round((timecode % 1) * fps)
  return `capture_${String(m).padStart(2, '0')}m${String(sec).padStart(2, '0')}s${String(fr).padStart(2, '0')}f.jpg`
}
