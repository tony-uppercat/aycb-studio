/**
 * Pure helpers for reference-aware IndexedDB media eviction.
 * Extracted from mediaStore so the eviction policy is unit-testable
 * without IndexedDB.
 */

export interface ProjectLike {
  mediaIds: string[]
  canvas?: { nodes?: Array<{ data: unknown }> } | null
}

/** Every mediaId referenced by any project: registry, node media, history, frames. */
export function collectReferencedIds(projects: ProjectLike[]): Set<string> {
  const referenced = new Set<string>()
  for (const project of projects) {
    for (const id of project.mediaIds) referenced.add(id)
    for (const node of project.canvas?.nodes || []) {
      const d = node.data as Record<string, unknown>
      if (typeof d.mediaId === 'string') referenced.add(d.mediaId)
      if (Array.isArray(d.historyIds))
        for (const h of d.historyIds) if (typeof h === 'string') referenced.add(h)
      if (Array.isArray(d.frameIds))
        for (const f of d.frameIds) if (typeof f === 'string') referenced.add(f)
    }
  }
  return referenced
}

/**
 * Pick blobs to evict when the store exceeds `cap`: orphans only, oldest
 * first (ids embed Date.now, so lexicographic sort ≈ chronological).
 * Referenced media is NEVER evicted — if everything is referenced the
 * store is allowed to stay over cap.
 */
export function selectCapEvictions(
  allIds: string[],
  referenced: Set<string>,
  cap: number,
): string[] {
  if (allIds.length <= cap) return []
  const orphans = allIds.filter(id => !referenced.has(id)).sort()
  return orphans.slice(0, allIds.length - cap)
}
