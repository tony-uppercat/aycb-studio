import { useState, useEffect } from 'react'
import { rhApi } from '../services/api'
import { useUserStore } from '../stores/userStore'
import { socket } from '../services/socket'
import { UserNameModal } from './UserNameModal'

interface Props { mediaId: number }

export function CommentThread({ mediaId }: Props) {
  const { userName } = useUserStore()
  const [comments, setComments] = useState<any[]>([])
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [showNameModal, setShowNameModal] = useState(false)

  const load = async () => {
    const data = await rhApi.listComments(mediaId)
    setComments(data.comments || [])
  }

  useEffect(() => { load() }, [mediaId])

  // Listen for real-time comments
  useEffect(() => {
    const handler = (data: any) => { if (data.media_id === mediaId) load() }
    socket.on('comment_new', handler)
    return () => { socket.off('comment_new', handler) }
  }, [mediaId])

  const submit = async () => {
    if (!text.trim()) return
    if (!userName) { setShowNameModal(true); return }
    await rhApi.addComment({
      media_id: mediaId, author: userName, content: text.trim(),
      ...(replyTo ? { parent_id: replyTo } : {}),
    })
    socket.emit('comment_new', { media_id: mediaId })
    setText('')
    setReplyTo(null)
    load()
  }

  const handleDelete = async (id: number) => {
    await rhApi.deleteComment(id)
    load()
  }

  // Build thread tree
  const roots = comments.filter(c => !c.parent_id)
  const replies = (parentId: number) => comments.filter(c => c.parent_id === parentId)

  const renderComment = (c: any, depth = 0) => (
    <div key={c.id} className="rh-comment-item" style={{ marginLeft: depth * 16 }}>
      <div className="rh-comment-header">
        <strong>{c.author || 'Anonymous'}</strong>
        {c.annotation_type && c.annotation_type !== 'pin' && (
          <span className="rh-comment-badge">{c.annotation_type}</span>
        )}
        <span className="rh-comment-time">{new Date(c.created_at).toLocaleTimeString()}</span>
      </div>
      <p className="rh-comment-text">{c.content}</p>
      <div className="rh-comment-actions">
        <button className="rh-comment-action" onClick={() => setReplyTo(c.id)}>Reply</button>
        {c.author === userName && (
          <button className="rh-comment-action rh-comment-delete" onClick={() => handleDelete(c.id)}>Delete</button>
        )}
      </div>
      {replies(c.id).map(r => renderComment(r, depth + 1))}
    </div>
  )

  return (
    <div className="rh-comments">
      <div className="rh-comments-list">
        {roots.length === 0 && <p className="rh-comments-empty">No comments yet</p>}
        {roots.map(c => renderComment(c))}
      </div>
      <div className="rh-comment-input-wrap">
        {replyTo && (
          <div className="rh-reply-indicator">
            Replying to #{replyTo} <button onClick={() => setReplyTo(null)}>&#xD7;</button>
          </div>
        )}
        <div className="rh-comment-input-row">
          <input className="rh-comment-input" value={text} onChange={e => setText(e.target.value)}
            placeholder="Add a comment..." onKeyDown={e => { if (e.key === 'Enter') submit() }} />
          <button className="rh-comment-send" onClick={submit}>Send</button>
        </div>
      </div>
      {showNameModal && (
        <UserNameModal onClose={() => setShowNameModal(false)} onSave={() => { setShowNameModal(false); submit() }} />
      )}
    </div>
  )
}
