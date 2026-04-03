import { useState, useEffect, useRef, useCallback } from 'react'
import { rhApi } from '../services/api'
import { socket } from '../services/socket'
import { useUserStore } from '../stores/userStore'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Comment {
  id: number
  media_id: number
  author: string
  content: string
  parent_id: number | null
  x_position: number | null
  y_position: number | null
  created_at: string
}

interface CommentNode extends Comment {
  replies: CommentNode[]
}

interface CommentThreadProps {
  mediaId: number
  position?: { x: number; y: number }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function buildTree(flat: Comment[]): CommentNode[] {
  const map = new Map<number, CommentNode>()
  flat.forEach(c => map.set(c.id, { ...c, replies: [] }))
  const roots: CommentNode[] = []
  flat.forEach(c => {
    const node = map.get(c.id)!
    if (c.parent_id != null && map.has(c.parent_id)) {
      map.get(c.parent_id)!.replies.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

function sanitize(text: string): string {
  return text.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] ?? c))
}

// ---------------------------------------------------------------------------
// CommentThread
// ---------------------------------------------------------------------------

export function CommentThread({ mediaId, position }: CommentThreadProps) {
  const { userName, getInitials } = useUserStore()
  const [comments, setComments] = useState<Comment[]>([])
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // -------------------------------------------------------------------------
  // Fetch on mount / mediaId change
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    rhApi.listComments(mediaId)
      .then(data => { if (!cancelled) setComments((data.comments as Comment[]) || []) })
      .catch(err => { if (!cancelled) console.warn('[CommentThread] fetch failed:', err.message) })
    return () => { cancelled = true; ctrl.abort() }
  }, [mediaId])

  // -------------------------------------------------------------------------
  // Real-time socket events
  // -------------------------------------------------------------------------
  useEffect(() => {
    function handleNew(data: Comment) {
      if (data.media_id !== mediaId) return
      setComments(prev => prev.find(c => c.id === data.id) ? prev : [...prev, data])
    }
    function handleDelete(data: { id: number }) {
      setComments(prev => prev.filter(c => c.id !== data.id))
    }
    socket.on('comment_new', handleNew)
    socket.on('comment_delete', handleDelete)
    return () => { socket.off('comment_new', handleNew); socket.off('comment_delete', handleDelete) }
  }, [mediaId])

  // -------------------------------------------------------------------------
  // Auto-scroll to bottom on new comments
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [comments])

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------
  const handleSubmit = useCallback(async () => {
    const trimmed = sanitize(text.trim())
    if (!trimmed || submitting || !userName) return
    setSubmitting(true)
    try {
      const created = await rhApi.addComment({
        media_id: mediaId,
        author: userName,
        content: trimmed,
        parent_id: replyTo ?? undefined,
        x_position: position?.x,
        y_position: position?.y,
      })
      setComments(prev => prev.find(c => c.id === created.id) ? prev : [...prev, {
        id: created.id, media_id: mediaId, author: userName, content: trimmed,
        parent_id: replyTo, x_position: position?.x ?? null, y_position: position?.y ?? null,
        created_at: new Date().toISOString(),
      }])
      setText('')
      setReplyTo(null)
    } catch (err: unknown) {
      console.error('[CommentThread] submit failed:', (err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }, [text, submitting, userName, mediaId, replyTo, position])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }, [handleSubmit])

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------
  const handleDelete = useCallback(async (id: number) => {
    try {
      await rhApi.deleteComment(id)
      setComments(prev => prev.filter(c => c.id !== id))
    } catch (err: unknown) {
      console.error('[CommentThread] delete failed:', (err as Error).message)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Render tree
  // -------------------------------------------------------------------------
  function renderComment(c: CommentNode, isReply = false) {
    const initial = (c.author || '?').charAt(0).toUpperCase()
    const isOwn = c.author === userName
    return (
      <div key={c.id} className={`rh-comment-item${isReply ? ' rh-comment-reply' : ''}`}>
        <div className="rh-comment-avatar">{initial}</div>
        <div className="rh-comment-body">
          <div className="rh-comment-header">
            <strong>{c.author || 'Anonymous'}</strong>
            <span className="rh-comment-time">{relativeTime(c.created_at)}</span>
          </div>
          <p className="rh-comment-text">{c.content}</p>
          <div className="rh-comment-actions">
            {!isReply && (
              <button className="rh-comment-action" onClick={() => setReplyTo(c.id)}>Reply</button>
            )}
            {isOwn && (
              <button className="rh-comment-action rh-comment-delete" onClick={() => handleDelete(c.id)}>Delete</button>
            )}
          </div>
        </div>
        {c.replies.length > 0 && (
          <div className="rh-comment-replies">
            {c.replies.map(r => renderComment(r, true))}
          </div>
        )}
      </div>
    )
  }

  const tree = buildTree(comments)
  const replyAuthor = replyTo != null ? (comments.find(c => c.id === replyTo)?.author ?? 'comment') : null

  const containerStyle = position
    ? { position: 'absolute' as const, left: position.x, top: position.y }
    : undefined

  return (
    <div className={`rh-comments${position ? ' rh-comments-floating' : ''}`} style={containerStyle}>
      <div className="rh-comments-list" ref={listRef}>
        {tree.length === 0 && <p className="rh-comments-empty">No comments yet</p>}
        {tree.map(c => renderComment(c))}
      </div>
      <div className="rh-comment-input-wrap">
        {replyTo != null && (
          <div className="rh-reply-indicator">
            <span>Replying to {replyAuthor}</span>
            <button onClick={() => setReplyTo(null)}>Cancel</button>
          </div>
        )}
        <div className="rh-comment-input-row">
          <textarea
            className="rh-comment-input"
            placeholder={userName ? 'Add a comment...' : 'Set your name to comment'}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={!userName}
          />
          <button
            className="rh-comment-send"
            onClick={handleSubmit}
            disabled={!text.trim() || submitting || !userName}
          >
            {submitting ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CommentThread
