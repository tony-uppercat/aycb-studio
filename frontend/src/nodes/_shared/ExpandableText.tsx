import { useEffect, useRef } from 'react'
import { useMediaPreview } from '../../components/media/MediaPreview'
import styles from './Node.module.css'

interface Props {
  value: string
  rows?: number
  placeholder?: string
  onEdit?: (text: string) => void
}

/** Read-only textarea with Ctrl+Shift fullscreen and hover expand button. Pass onEdit to enable editing. */
export function ExpandableText({ value, rows = 4, placeholder, onEdit }: Props) {
  const { openPreview } = useMediaPreview()
  const wrapRef = useRef<HTMLDivElement>(null)
  const hoveredRef = useRef(false)

  const open = () => {
    if (!value) return
    openPreview(value, 'text', onEdit ? { onEdit } : undefined)
  }

  const openRef = useRef(open)
  // eslint-disable-next-line react-hooks/refs
  openRef.current = open

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && hoveredRef.current) {
        e.preventDefault()
        e.stopPropagation()
        openRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      ref={wrapRef}
      className={styles.expandWrap}
      onMouseEnter={() => { hoveredRef.current = true }}
      onMouseLeave={() => { hoveredRef.current = false }}
    >
      <textarea
        className={styles.resultArea}
        readOnly
        value={value || placeholder || ''}
        rows={rows}
      />
      {value && (
        <button
          className={styles.expandBtn}
          onClick={(e) => { e.stopPropagation(); open() }}
          title="Full screen (Ctrl+Shift)"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </button>
      )}
    </div>
  )
}
