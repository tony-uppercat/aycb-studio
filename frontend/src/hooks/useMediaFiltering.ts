import { useMemo } from 'react'
import { type ReviewStatus } from '../utils/reviewStatus'

export type SortOption = 'newest' | 'oldest' | 'largest' | 'name'
export type FilterOption = 'all' | 'images' | 'videos' | 'favorites' | 'approved' | 'rejected'

interface Filterable {
  id: string
  name?: string
  filename?: string
  size: number
  type: string
}

export function useMediaFiltering<T extends Filterable>(
  entries: T[],
  sortBy: SortOption,
  filterBy: FilterOption,
  reviewStatuses: Record<string, ReviewStatus | null>,
): T[] {
  return useMemo(() => {
    let list = [...entries]

    if (filterBy === 'images') list = list.filter(e => e.type.startsWith('image/'))
    else if (filterBy === 'videos') list = list.filter(e => e.type.startsWith('video/'))
    else if (filterBy === 'favorites') list = list.filter(e => reviewStatuses[e.id]?.favorite)
    else if (filterBy === 'approved') list = list.filter(e => reviewStatuses[e.id]?.status === 'approved')
    else if (filterBy === 'rejected') list = list.filter(e => reviewStatuses[e.id]?.status === 'rejected')

    const nameOf = (e: T) => e.name ?? (e as T & { filename?: string }).filename ?? e.id

    switch (sortBy) {
      case 'newest': list.sort((a, b) => b.id.localeCompare(a.id)); break
      case 'oldest': list.sort((a, b) => a.id.localeCompare(b.id)); break
      case 'largest': list.sort((a, b) => b.size - a.size); break
      case 'name': list.sort((a, b) => nameOf(a).localeCompare(nameOf(b))); break
    }

    return list
  }, [entries, sortBy, filterBy, reviewStatuses])
}
