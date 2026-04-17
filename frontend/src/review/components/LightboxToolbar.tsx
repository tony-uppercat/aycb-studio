import { Star, Check, X, MessageSquare, Pencil, Download, Trash2, Info } from 'lucide-react'

interface LightboxToolbarProps {
  media: { id: number; filename: string; is_favorite?: boolean; status?: string }
  show_comments: boolean
  is_drawing: boolean
  is_admin: boolean
  show_info?: boolean
  on_toggle_fav: () => void
  on_approve: () => void
  on_reject: () => void
  on_toggle_comments: () => void
  on_toggle_drawing: () => void
  on_toggle_info?: () => void
  on_download: () => void
  on_delete: () => void
  on_close: () => void
}

export function LightboxToolbar({
  media,
  show_comments,
  is_drawing,
  is_admin,
  show_info,
  on_toggle_fav,
  on_approve,
  on_reject,
  on_toggle_comments,
  on_toggle_drawing,
  on_toggle_info,
  on_download,
  on_delete,
  on_close,
}: LightboxToolbarProps) {
  const is_approved = media.status === 'approved'
  const is_rejected = media.status === 'rejected'

  return (
    <div className="rh-lb-toolbar">
      <span className="rh-lb-filename">{media.filename}</span>
      <div className="rh-lb-actions">
        <button
          className={`rh-lb-btn${media.is_favorite ? ' rh-lb-btn-fav' : ''}`}
          onClick={on_toggle_fav}
          title="Favorite (F)"
        >
          <Star
            size={16}
            strokeWidth={1.5}
            fill={media.is_favorite ? 'currentColor' : 'none'}
          />
        </button>
        <button
          className={`rh-lb-btn${is_approved ? ' rh-lb-btn-approved' : ''}`}
          onClick={on_approve}
          title="Approve (A)"
        >
          <Check size={16} strokeWidth={1.5} />
        </button>
        <button
          className={`rh-lb-btn${is_rejected ? ' rh-lb-btn-rejected' : ''}`}
          onClick={on_reject}
          title="Reject (R)"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
        <button
          className={`rh-lb-btn${show_comments ? ' rh-lb-btn-accent' : ''}`}
          onClick={on_toggle_comments}
          title="Comments (C)"
        >
          <MessageSquare size={16} strokeWidth={1.5} />
        </button>
        <button
          className={`rh-lb-btn${is_drawing ? ' rh-lb-btn-accent' : ''}`}
          onClick={on_toggle_drawing}
          title="Draw (D)"
        >
          <Pencil size={16} strokeWidth={1.5} />
        </button>
        {on_toggle_info && (
          <button
            className={`rh-lb-btn${show_info ? ' rh-lb-btn-accent' : ''}`}
            onClick={on_toggle_info}
            title="Info (I)"
          >
            <Info size={16} strokeWidth={1.5} />
          </button>
        )}
        <button
          className="rh-lb-btn"
          onClick={on_download}
          title="Download (S)"
        >
          <Download size={16} strokeWidth={1.5} />
        </button>
        {is_admin && (
          <button
            className="rh-lb-btn rh-lb-btn-danger"
            onClick={on_delete}
            title="Delete"
          >
            <Trash2 size={16} strokeWidth={1.5} />
          </button>
        )}
        <button
          className="rh-lb-btn"
          onClick={on_close}
          title="Close (Esc)"
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}
