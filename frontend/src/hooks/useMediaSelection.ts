import { useCallback, useRef, useState } from 'react'

interface UseMediaSelectionResult {
  selected: Set<string>
  toggleSelect: (id: string, idx: number, orderedIds: string[], shiftKey: boolean, ctrlKey: boolean) => void
  clearSelection: () => void
  selectAll: (ids: string[]) => void
}

/**
 * Manages multi-select state for a list of media items.
 *
 * `toggleSelect` mirrors browser file-manager conventions:
 *  - Shift+click → range-select from last clicked item to current
 *  - Ctrl/Cmd+click → toggle individual item
 *  - Plain click → select only this item (deselect if already the only selection)
 *
 * The caller is responsible for passing `orderedIds` (the currently displayed,
 * sorted list of IDs) so that shift-range selection always reflects the visible order.
 */
export function useMediaSelection(): UseMediaSelectionResult {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClickedRef = useRef<number>(0)

  const toggleSelect = useCallback(
    (id: string, idx: number, orderedIds: string[], shiftKey: boolean, ctrlKey: boolean) => {
      setSelected(prev => {
        const next = new Set(prev)
        if (shiftKey && orderedIds.length > 0) {
          const start = Math.min(lastClickedRef.current, idx)
          const end = Math.max(lastClickedRef.current, idx)
          for (let i = start; i <= end; i++) next.add(orderedIds[i])
        } else if (ctrlKey) {
          if (next.has(id)) next.delete(id)
          else next.add(id)
        } else {
          if (next.size === 1 && next.has(id)) next.clear()
          else { next.clear(); next.add(id) }
        }
        lastClickedRef.current = idx
        return next
      })
    },
    [],
  )

  const clearSelection = useCallback(() => {
    setSelected(new Set())
  }, [])

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids))
  }, [])

  return { selected, toggleSelect, clearSelection, selectAll }
}
