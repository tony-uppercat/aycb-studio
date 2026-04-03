import { useEffect, useCallback, useState } from 'react'
import { rhApi } from '../services/api'
import { useUserStore } from '../stores/userStore'
import { useDrawingStore } from '../stores/drawingStore'
import { toast } from '../stores/toastStore'
import CommentThread from './CommentThread'
import { DrawingCanvas } from './DrawingCanvas'
import DrawingToolbar from './DrawingToolbar'
import { LightboxToolbar } from './LightboxToolbar'
import { LightboxFooter } from './LightboxFooter'

interface MediaItem {
  id: number
  filename: string
  media_url?: string
  mime_type?: string
  metadata?: string
  is_favorite?: boolean
  status?: string
}

interface LightboxProps {
  media: MediaItem
  items: MediaItem[]
  on_close: () => void
  on_navigate: (id: number) => void
  on_refresh: () => void
}

export function Lightbox({ media, items, on_close, on_navigate, on_refresh }: LightboxProps) {
  const { userName, isAdmin } = useUserStore()
  const { is_drawing_mode, toggleDrawingMode, resetForMedia } = useDrawingStore()
  const [show_comments, set_show_comments] = useState(false)

  const current_index = items.findIndex((m) => m.id === media.id)
  const is_video = media.mime_type?.startsWith('video/') ?? false
  const img_src = media.media_url ?? `/api/rh/media/${media.id}/stream`

  const go_prev = useCallback(() => {
    if (current_index > 0) on_navigate(items[current_index - 1].id)
  }, [current_index, items, on_navigate])

  const go_next = useCallback(() => {
    if (current_index < items.length - 1) on_navigate(items[current_index + 1].id)
  }, [current_index, items, on_navigate])

  const handle_toggle_fav = useCallback(async () => {
    try {
      await rhApi.toggleFavorite({ media_id: media.id, user_name: userName || 'anonymous' })
      on_refresh()
    } catch { toast.error('Failed to update favorite') }
  }, [media.id, userName, on_refresh])

  const handle_approve = useCallback(async () => {
    try {
      await rhApi.toggleFavorite({ media_id: media.id, user_name: userName || 'anonymous', status: 'approved' })
      on_refresh()
    } catch { toast.error('Failed to approve') }
  }, [media.id, userName, on_refresh])

  const handle_reject = useCallback(async () => {
    try {
      await rhApi.toggleFavorite({ media_id: media.id, user_name: userName || 'anonymous', status: 'rejected' })
      on_refresh()
    } catch { toast.error('Failed to reject') }
  }, [media.id, userName, on_refresh])

  const handle_download = useCallback(() => {
    window.open(rhApi.downloadUrl(media.id))
  }, [media.id])

  const handle_delete = useCallback(async () => {
    try {
      await rhApi.deleteMedia(media.id)
      on_refresh()
      on_close()
      toast.success('Deleted')
    } catch { toast.error('Failed to delete') }
  }, [media.id, on_refresh, on_close])

  const handle_keydown = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      switch (e.key) {
        case 'Escape': on_close(); break
        case 'ArrowLeft': go_prev(); break
        case 'ArrowRight': go_next(); break
        case 'c': case 'C': set_show_comments((v) => !v); break
        case 'd': case 'D': toggleDrawingMode(); break
        case 'a': case 'A': handle_approve(); break
        case 'r': case 'R': handle_reject(); break
        case 's': case 'S': handle_download(); break
      }
    },
    [on_close, go_prev, go_next, toggleDrawingMode, handle_approve, handle_reject, handle_download],
  )

  useEffect(() => {
    document.addEventListener('keydown', handle_keydown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handle_keydown)
      document.body.style.overflow = ''
    }
  }, [handle_keydown])

  useEffect(() => {
    resetForMedia()
  }, [media.id, resetForMedia])

  return (
    <div className="rh-lightbox-overlay">
      <div className="rh-lightbox-header">
        <LightboxToolbar
          media={media}
          show_comments={show_comments}
          is_drawing={is_drawing_mode}
          is_admin={isAdmin()}
          on_toggle_fav={handle_toggle_fav}
          on_approve={handle_approve}
          on_reject={handle_reject}
          on_toggle_comments={() => set_show_comments((v) => !v)}
          on_toggle_drawing={toggleDrawingMode}
          on_download={handle_download}
          on_delete={handle_delete}
          on_close={on_close}
        />
      </div>
      <div className="rh-lightbox-body">
        <div className="rh-lightbox-image-area">
          <button
            className="rh-lightbox-nav rh-lightbox-prev"
            onClick={go_prev}
            disabled={current_index <= 0}
            aria-label="Previous"
          >
            &#8249;
          </button>
          <div className="rh-lightbox-image-wrap">
            {is_video ? (
              <video
                src={img_src}
                className="rh-lightbox-video"
                controls
                autoPlay
              />
            ) : (
              <img
                src={img_src}
                alt={media.filename}
                className="rh-lightbox-img"
              />
            )}
            {is_drawing_mode && <DrawingCanvas mediaId={media.id} />}
          </div>
          <button
            className="rh-lightbox-nav rh-lightbox-next"
            onClick={go_next}
            disabled={current_index >= items.length - 1}
            aria-label="Next"
          >
            &#8250;
          </button>
        </div>
        {show_comments && (
          <div className="rh-lightbox-comment-panel">
            <CommentThread mediaId={media.id} />
          </div>
        )}
      </div>
      {is_drawing_mode && <DrawingToolbar />}
      <div className="rh-lightbox-footer-bar">
        <LightboxFooter
          media={media}
          current_index={current_index}
          total={items.length}
        />
      </div>
    </div>
  )
}
