import React, { useRef, useCallback } from 'react'
import { MediaCard, type MediaCardMedia } from './MediaCard'

interface Props {
  items: MediaCardMedia[]
  selectedId: number | null
  onSelect: (id: number) => void
  onDoubleClick: (id: number) => void
  selected_ids?: Set<number>
  show_checkboxes?: boolean
  is_admin?: boolean
  on_card_select?: (id: number, e: React.MouseEvent) => void
  on_context_menu?: (id: number, e: React.MouseEvent) => void
  on_delete?: (id: number) => void
}

const DBLCLICK_MS = 250

export function MediaGrid({
  items,
  selectedId,
  onSelect,
  onDoubleClick,
  selected_ids,
  show_checkboxes = false,
  is_admin = false,
  on_card_select,
  on_context_menu,
  on_delete,
}: Props) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = useCallback((id: number) => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      onDoubleClick(id)
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null
        onSelect(id)
      }, DBLCLICK_MS)
    }
  }, [onSelect, onDoubleClick])

  if (items.length === 0) {
    return <div className="rh-grid-empty">No media found</div>
  }

  return (
    <div className="rh-grid">
      {items.map(item => (
        <MediaCard
          key={item.id}
          media={item}
          selected={selected_ids?.has(item.id) ?? selectedId === item.id}
          show_checkbox={show_checkboxes}
          is_admin={is_admin}
          on_click={() => handleClick(item.id)}
          on_select={(e) => on_card_select?.(item.id, e)}
          on_context_menu={(e) => on_context_menu?.(item.id, e)}
          on_delete={on_delete ? () => on_delete(item.id) : undefined}
        />
      ))}
    </div>
  )
}
