import { useEffect, useRef } from 'react'

interface ContextMenuItem {
  label: string
  danger?: boolean
  on_click: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  on_close: () => void
}

export function ContextMenu({ x, y, items, on_close }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        on_close()
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [on_close])

  return (
    <div
      ref={menuRef}
      className="rh-context-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 2000 }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`rh-context-menu-item${item.danger ? ' rh-context-menu-item--danger' : ''}`}
          onClick={() => { item.on_click(); on_close() }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
