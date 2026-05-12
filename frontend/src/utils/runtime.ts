/**
 * Runtime environment detection — one line of truth for whether the
 * FastAPI backend is reachable. Previously duplicated in api.ts and
 * ReviewTab.tsx; v2 audit finding m2.
 */
export function isBackendAvailable(): boolean {
  return (
    location.port === '5100' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1'
  )
}
