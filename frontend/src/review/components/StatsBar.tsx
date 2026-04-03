interface StatsBarProps {
  total: number
  favorite_count: number
  comment_count: number
}

export function StatsBar({ total, favorite_count, comment_count }: StatsBarProps) {
  return (
    <div className="rh-stats-bar">
      <span className="rh-stats-item">
        <span className="rh-stats-value">{total}</span>
        <span className="rh-stats-label">total</span>
      </span>
      <span className="rh-stats-divider" />
      <span className="rh-stats-item">
        <span className="rh-stats-value">{favorite_count}</span>
        <span className="rh-stats-label">favorites</span>
      </span>
      <span className="rh-stats-divider" />
      <span className="rh-stats-item">
        <span className="rh-stats-value">{comment_count}</span>
        <span className="rh-stats-label">with comments</span>
      </span>
    </div>
  )
}
