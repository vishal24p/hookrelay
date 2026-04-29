export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmTone,
  onClose,
  onConfirm,
  disabled,
}) {
  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-section">
          <div className="eyebrow">Confirm action</div>
          <h2 className="title" style={{ marginTop: 10 }}>{title}</h2>
          <p className="subtle-copy" style={{ marginTop: 12 }}>{description}</p>
        </div>

        <div className="modal-section row-between">
          <button className="ghost-button" onClick={onClose} disabled={disabled}>
            Cancel
          </button>
          <button
            className={confirmTone === 'danger' ? 'danger-button' : 'secondary-button'}
            onClick={onConfirm}
            disabled={disabled}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
