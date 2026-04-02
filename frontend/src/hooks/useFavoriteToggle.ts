import { useCallback } from 'react'
import { toggleFavorite, type ReviewStatus } from '../utils/reviewStatus'

export function useFavoriteToggle(
  setReviewStatuses: React.Dispatch<React.SetStateAction<Record<string, ReviewStatus | null>>>,
) {
  return useCallback(async (id: string) => {
    setReviewStatuses(p => {
      const c = p[id]
      return {
        ...p,
        [id]: c
          ? { ...c, favorite: !c.favorite }
          : { status: null, reviewed_by: null, reviewed_at: null, comments_count: 0, drawings_count: 0, favorite: true },
      }
    })
    const ok = await toggleFavorite(id)
    if (!ok) {
      setReviewStatuses(p => {
        const c = p[id]
        return c ? { ...p, [id]: { ...c, favorite: !c.favorite } } : p
      })
    }
  }, [setReviewStatuses])
}
