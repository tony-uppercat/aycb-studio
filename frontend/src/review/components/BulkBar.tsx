interface BulkBarProps {
  selected_count: number
  total_count: number
  is_admin: boolean
  on_select_all: () => void
  on_clear: () => void
  on_approve: () => void
  on_reject: () => void
  on_download: () => void
  on_delete: () => void
  on_move: () => void
}

export function BulkBar({
  selected_count,
  total_count,
  is_admin,
  on_select_all,
  on_clear,
  on_approve,
  on_reject,
  on_download,
  on_delete,
  on_move,
}: BulkBarProps) {
  const disabled = selected_count === 0

  return (
    <div className="rh-bulk-bar">
      <div className="rh-bulk-info">
        <span className="rh-bulk-badge">{selected_count}</span>
        <span className="rh-bulk-label">of {total_count} selected</span>
        <button className="rh-bulk-select-all" onClick={on_select_all}>
          Select All
        </button>
        <button className="rh-bulk-btn-clear" onClick={on_clear} title="Clear selection">
          x
        </button>
      </div>

      <div className="rh-bulk-actions">
        <button
          className="rh-bulk-btn rh-bulk-btn-approve"
          onClick={on_approve}
          disabled={disabled}
        >
          Approve
        </button>
        <button
          className="rh-bulk-btn rh-bulk-btn-reject"
          onClick={on_reject}
          disabled={disabled}
        >
          Reject
        </button>
        <button
          className="rh-bulk-btn rh-bulk-btn-download"
          onClick={on_download}
          disabled={disabled}
        >
          Download
        </button>
        <button
          className="rh-bulk-btn"
          onClick={on_move}
          disabled={disabled}
        >
          Move
        </button>
        {is_admin && (
          <button
            className="rh-bulk-btn rh-bulk-btn-delete"
            onClick={on_delete}
            disabled={disabled}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
