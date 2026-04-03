interface DeleteConfirmModalProps {
  filename?: string
  count?: number
  on_confirm: () => void
  on_cancel: () => void
}

export function DeleteConfirmModal({
  filename,
  count,
  on_confirm,
  on_cancel,
}: DeleteConfirmModalProps) {
  const title = filename
    ? `Delete "${filename}"?`
    : `Delete ${count ?? 0} items?`

  const body = filename
    ? 'This action cannot be undone.'
    : `${count ?? 0} files will be permanently deleted. This action cannot be undone.`

  return (
    <div className="rh-delete-modal-overlay" onClick={on_cancel}>
      <div className="rh-delete-modal" onClick={e => e.stopPropagation()}>
        <div className="rh-delete-modal-title">{title}</div>
        <div className="rh-delete-modal-text">{body}</div>
        <div className="rh-delete-modal-actions">
          <button className="rh-delete-modal-cancel" onClick={on_cancel}>
            Cancel
          </button>
          <button className="rh-delete-modal-confirm" onClick={on_confirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
