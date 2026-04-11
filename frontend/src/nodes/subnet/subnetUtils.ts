/**
 * Force a string into snake_case: lowercase, non-alnum collapsed to single
 * underscore, trimmed, and prefixed with `_` if the result starts with a digit
 * (invalid identifier). Returns empty string if input yields nothing.
 */
export function toSnakeCase(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!cleaned) return ''
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned
}
