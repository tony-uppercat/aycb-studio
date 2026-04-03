import { useEffect, useState } from 'react'
import { rhApi } from '../services/api'
import { useUserStore } from '../stores/userStore'
import CommentThread from './CommentThread'

interface MediaItem {
  id: number
  filename: string
  media_url?: string
  width?: number
  height?: number
  file_size?: number
}

interface Favorite {
  user_name: string
  status: string
}

interface Props {
  media: MediaItem
  onClose: () => void
  onRefresh: () => void
}

export function Sidebar({ media, onClose, onRefresh }: Props) {
  const { user_name } = useUserStore()
  const [favorites, setFavorites] = useState<Favorite[]>([])

  useEffect(() => {
    rhApi.getFavorites(media.id)
      .then(d => setFavorites(d.favorites as Favorite[]))
      .catch(() => { /* swallow */ })
  }, [media.id])

  const toggleFav = async (status: string) => {
    if (!user_name) return
    await rhApi.toggleFavorite({ media_id: media.id, user_name: user_name, status })
    const d = await rhApi.getFavorites(media.id)
    setFavorites(d.favorites as Favorite[])
    onRefresh()
  }

  const myFav = favorites.find(f => f.user_name === user_name)

  return (
    <div className="rh-sidebar">
      <div className="rh-sidebar-header">
        <span className="rh-sidebar-title">{media.filename}</span>
        <button className="rh-sidebar-close" onClick={onClose}>&times;</button>
      </div>
      <img src={media.media_url ?? `/media/${media.filename}`} alt="" className="rh-sidebar-preview" />
      <div className="rh-sidebar-meta">
        {media.width != null && media.height != null && (
          <span>{media.width}&times;{media.height}</span>
        )}
        {media.file_size != null && (
          <span>{(media.file_size / 1024).toFixed(0)} KB</span>
        )}
      </div>
      <div className="rh-sidebar-actions">
        <button
          className={`rh-fav-btn ${myFav?.status === 'favorite' ? 'active' : ''}`}
          onClick={() => toggleFav('favorite')}
        >
          &#9733;
        </button>
        <button
          className={`rh-approve-btn ${myFav?.status === 'approved' ? 'active' : ''}`}
          onClick={() => toggleFav('approved')}
        >
          &#10003;
        </button>
        <button
          className={`rh-reject-btn ${myFav?.status === 'rejected' ? 'active' : ''}`}
          onClick={() => toggleFav('rejected')}
        >
          &#10007;
        </button>
      </div>
      <div className="rh-sidebar-comments">
        <h4>Comments</h4>
        <CommentThread mediaId={media.id} />
      </div>
    </div>
  )
}
