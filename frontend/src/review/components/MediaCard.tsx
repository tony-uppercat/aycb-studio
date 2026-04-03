import React from 'react'

export interface MediaCardMedia {
  id: number
  filename: string
  media_url?: string
  thumbnail_url?: string
  directory?: string
  mime_type?: string
  metadata?: string
  is_favorite?: boolean
  status?: string
  comment_count?: number
  drawing_count?: number
  width?: number
  height?: number
}

interface MediaCardProps {
  media: MediaCardMedia
  selected: boolean
  show_checkbox: boolean
  is_admin: boolean
  on_click: () => void
  on_select: (e: React.MouseEvent) => void
  on_context_menu: (e: React.MouseEvent) => void
  on_delete?: () => void
}

function parseDuration(metadata?: string): string | null {
  if (!metadata) return null
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    const secs = m?.duration
    if (!secs || typeof secs !== 'number') return null
    const mins = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${mins}:${String(s).padStart(2, '0')}`
  } catch {
    return null
  }
}

function parseModel(metadata?: string): string | null {
  if (!metadata) return null
  try {
    const m = typeof metadata === 'string' ? JSON.parse(metadata) : metadata
    return m?.model_name ?? null
  } catch {
    return null
  }
}

function thumbSrc(media: MediaCardMedia): string {
  return media.thumbnail_url ?? media.media_url ?? `/media/${media.filename}`
}

export function MediaCard({
  media,
  selected,
  show_checkbox,
  is_admin,
  on_click,
  on_select,
  on_context_menu,
  on_delete,
}: MediaCardProps) {
  const is_video = media.mime_type?.startsWith('video/') ?? false
  const duration = is_video ? parseDuration(media.metadata) : null
  const model = parseModel(media.metadata)

  return (
    <div
      className={`rh-card${selected ? ' rh-card--selected' : ''}`}
      tabIndex={0}
      onClick={on_click}
      onContextMenu={on_context_menu}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); on_click() } }}
    >
      {show_checkbox && (
        <div className="rh-card-checkbox" onClick={on_select}>
          <span className={`rh-card-check${selected ? ' rh-card-check--on' : ''}`}>
            {selected ? '\u2713' : ''}
          </span>
        </div>
      )}

      {is_admin && !show_checkbox && on_delete && (
        <button
          className="rh-card-delete"
          onClick={e => { e.stopPropagation(); on_delete() }}
          title="Delete"
        >
          &times;
        </button>
      )}

      <div className="rh-card-thumb">
        <img src={thumbSrc(media)} alt={media.filename} loading="lazy" draggable={false} className="rh-card-img" />
        {is_video && (
          <>
            <div className="rh-card-play-overlay">
              <span className="rh-card-play-icon">&#9654;</span>
            </div>
            {duration && <span className="rh-card-duration">{duration}</span>}
          </>
        )}
      </div>

      <div className="rh-card-badges">
        {media.is_favorite && <span className="rh-card-badge rh-card-badge--fav">&#9733;</span>}
        {!!media.comment_count && <span className="rh-card-badge rh-card-badge--comments">{media.comment_count}</span>}
        {!!media.drawing_count && <span className="rh-card-badge rh-card-badge--drawings">&#9998;</span>}
        {media.status === 'approved' && <span className="rh-card-badge rh-card-badge--approved">&#10003;</span>}
        {media.status === 'rejected' && <span className="rh-card-badge rh-card-badge--rejected">&#10007;</span>}
      </div>

      <div className="rh-card-info">
        <div className="rh-card-name">{media.filename}</div>
        <div className="rh-card-meta">
          {media.directory && <span className="rh-card-dir">{media.directory}</span>}
          {model && <span className="rh-card-model">{model}</span>}
        </div>
      </div>
    </div>
  )
}
