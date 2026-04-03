import { useEffect, useState } from 'react'
import { rhApi } from '../services/api'
import { useUserStore } from '../stores/userStore'

interface MediaItem {
  id: number
  filename: string
  width?: number
  height?: number
  file_size?: number
}

interface Comment {
  id: number
  author: string
  content: string
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
  const { userName } = useUserStore()
  const [comments, setComments] = useState<Comment[]>([])
  const [favorites, setFavorites] = useState<Favorite[]>([])

  useEffect(() => {
    rhApi.listComments(media.id)
      .then(d => setComments(d.comments as Comment[]))
      .catch(() => { /* swallow */ })
    rhApi.getFavorites(media.id)
      .then(d => setFavorites(d.favorites as Favorite[]))
      .catch(() => { /* swallow */ })
  }, [media.id])

  const toggleFav = async (status: string) => {
    if (!userName) return
    await rhApi.toggleFavorite({ media_id: media.id, user_name: userName, status })
    const d = await rhApi.getFavorites(media.id)
    setFavorites(d.favorites as Favorite[])
    onRefresh()
  }

  const myFav = favorites.find(f => f.user_name === userName)

  return (
    <div className="rh-sidebar">
      <div className="rh-sidebar-header">
        <span className="rh-sidebar-title">{media.filename}</span>
        <button className="rh-sidebar-close" onClick={onClose}>&times;</button>
      </div>
      <img src={`/media/${media.filename}`} alt="" className="rh-sidebar-preview" />
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
        <h4>Comments ({comments.length})</h4>
        {comments.map(c => (
          <div key={c.id} className="rh-comment">
            <strong>{c.author}</strong>: {c.content}
          </div>
        ))}
      </div>
    </div>
  )
}
