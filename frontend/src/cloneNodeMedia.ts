import { loadMedia, saveMediaForProject, generateMediaId } from './mediaStore'

// ── Clone Node Media (for duplicate/paste) ───────────────────────────────────

export interface CloneLoaders {
  load: (id: string) => Promise<File | null>
  save: (id: string, file: File) => Promise<void>
}

const DEFAULT_CLONE_LOADERS: CloneLoaders = {
  load: loadMedia,
  save: saveMediaForProject,
}

/**
 * Clone every media-ref field inside `node.data` to fresh ids in IndexedDB.
 * Used by ctxDuplicate / ctxPaste so cloned nodes own independent blobs.
 *
 * Recognised fields: `mediaId`, `historyIds[]`, `frameIds[]`, `outputMediaIds{}`.
 * Other fields pass through unchanged.
 *
 * Dedup: an id appearing in multiple fields clones only once per call.
 * Orphan ids (load returns null) are kept as-is with a console warning.
 */
export async function cloneNodeMedia(
  data: Record<string, unknown>,
  loaders: CloneLoaders = DEFAULT_CLONE_LOADERS,
): Promise<Record<string, unknown>> {
  const cache = new Map<string, Promise<string>>()

  function cloneOne(oldId: string): Promise<string> {
    const existing = cache.get(oldId)
    if (existing) return existing
    const promise = (async () => {
      const file = await loaders.load(oldId)
      if (!file) {
        console.warn(`[cloneNodeMedia] orphan id, keeping original: ${oldId}`)
        return oldId
      }
      const newId = generateMediaId()
      await loaders.save(newId, file)
      return newId
    })()
    cache.set(oldId, promise)
    return promise
  }

  const out: Record<string, unknown> = { ...data }

  if (typeof data.mediaId === 'string') {
    out.mediaId = await cloneOne(data.mediaId)
  }

  if (Array.isArray(data.historyIds)) {
    out.historyIds = await Promise.all(
      data.historyIds.map(id => typeof id === 'string' ? cloneOne(id) : Promise.resolve(id)),
    )
  }

  if (Array.isArray(data.frameIds)) {
    out.frameIds = await Promise.all(
      data.frameIds.map(id => typeof id === 'string' ? cloneOne(id) : Promise.resolve(id)),
    )
  }

  if (data.outputMediaIds && typeof data.outputMediaIds === 'object' && !Array.isArray(data.outputMediaIds)) {
    const oldMap = data.outputMediaIds as Record<string, unknown>
    const entries = await Promise.all(
      Object.entries(oldMap).map(async ([key, value]) =>
        typeof value === 'string' ? [key, await cloneOne(value)] as const : [key, value] as const,
      ),
    )
    out.outputMediaIds = Object.fromEntries(entries)
  }

  return out
}
