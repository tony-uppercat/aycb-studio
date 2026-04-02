/**
 * Format a byte count as a human-readable size string.
 * e.g. 1258291 → "1.2 MB"
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Extract a human-readable date from a media ID.
 * Media IDs follow the pattern: media-{timestamp}-{rand}
 * Returns empty string when the ID does not contain a parseable timestamp.
 */
export function formatDate(mediaId: string): string {
  const match = mediaId.match(/^media-(\d+)-/)
  if (!match) return ''
  const ts = parseInt(match[1], 10)
  if (isNaN(ts)) return ''
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
