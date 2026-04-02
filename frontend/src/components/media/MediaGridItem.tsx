import { formatSize, formatDate } from '../../utils/mediaFormatting'
import { type ReviewStatus } from '../../utils/reviewStatus'
import styles from './MediaBrowser.module.css'

interface Props {
  id: string
  name: string
  type: string
  size: number
  thumb: string | undefined
  isSelected: boolean
  review: ReviewStatus | null
  onSelect: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDownload: (e: React.MouseEvent) => void
  onFavoriteToggle: (e: React.MouseEvent) => void
}

export function MediaGridItem({
  id, name, type, size, thumb, isSelected, review,
  onSelect, onDoubleClick, onDragStart, onDragEnd, onDownload, onFavoriteToggle,
}: Props) {
  const isVideo = type.startsWith('video/')

  return (
    <div
      key={id}
      className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      <div className={styles.thumbWrap}>
        {thumb ? (
          isVideo
            ? <video src={thumb} className={styles.thumb} muted />
            : <img src={thumb} alt={name} className={styles.thumb} />
        ) : (
          <div className={styles.thumbPlaceholder}>
            {isVideo ? '\uD83C\uDFAC' : '\uD83D\uDDBC'}
          </div>
        )}
        <button
          className={`${styles.favBadge} ${review?.favorite ? styles.favBadgeActive : ''}`}
          onClick={onFavoriteToggle}
          title={review?.favorite ? 'Remove favorite' : 'Add favorite'}
        >{'\u2605'}</button>
        {review?.status === 'approved' && <span className={styles.approvedBadge} title="Approved">{'\u2713'}</span>}
        {review?.status === 'rejected' && <span className={styles.rejectedBadge} title="Rejected">{'\u2717'}</span>}
        <div className={styles.thumbOverlay}>
          <span className={styles.overlayName} title={name}>{name}</span>
          <span className={styles.overlayMeta}>{formatSize(size)}</span>
          <span className={styles.overlayMeta}>{formatDate(id)}</span>
        </div>
        <button className={styles.dlBtn} onClick={onDownload} title="Download">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </button>
      </div>
      <span className={styles.itemName} title={name}>{name}</span>
      <span className={styles.itemSize}>{formatSize(size)}</span>
    </div>
  )
}
