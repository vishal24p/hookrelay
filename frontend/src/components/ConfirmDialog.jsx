import { useEffect, useId, useRef, useState } from 'react'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusableElements(container) {
  if (!container) return []
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.getAttribute('aria-hidden'),
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmTone,
  confirmationValue = '',
  confirmationLabel = 'Confirmation value',
  onClose,
  onConfirm,
  disabled,
}) {
  const titleId = useId()
  const descriptionId = useId()
  const confirmationInputId = useId()
  const confirmationHintId = useId()
  const dialogRef = useRef(null)
  const cancelButtonRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [typedConfirmation, setTypedConfirmation] = useState('')
  const requiresTypedConfirmation = Boolean(confirmationValue)
  const confirmationMatches = !requiresTypedConfirmation || typedConfirmation === confirmationValue
  const confirmDisabled = disabled || !confirmationMatches

  useEffect(() => {
    if (!open) return undefined

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTypedConfirmation('')
    window.setTimeout(() => {
      cancelButtonRef.current?.focus()
    }, 0)

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!disabled) {
          onClose()
        }
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const focusableElements = getFocusableElements(dialogRef.current)
      if (focusableElements.length === 0) {
        event.preventDefault()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [disabled, onClose, open])

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <button
        aria-label="Close dialog"
        className="modal-backdrop-dismiss"
        disabled={disabled}
        onClick={onClose}
        type="button"
      />
      <div
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="modal-section">
          <div className="eyebrow">Confirm action</div>
          <h2 id={titleId} className="title" style={{ marginTop: 10 }}>
            {title}
          </h2>
          <p id={descriptionId} className="subtle-copy" style={{ marginTop: 12 }}>
            {description}
          </p>
          {requiresTypedConfirmation ? (
            <div className="confirmation-field">
              <label htmlFor={confirmationInputId} className="confirmation-label">
                Type {confirmationValue} to confirm.
              </label>
              <input
                id={confirmationInputId}
                className="text-input"
                value={typedConfirmation}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                aria-describedby={confirmationHintId}
                autoComplete="off"
                spellCheck="false"
              />
              <p id={confirmationHintId} className="helper-note">
                {confirmationLabel} must match exactly.
              </p>
            </div>
          ) : null}
        </div>

        <div className="modal-section row-between">
          <button
            ref={cancelButtonRef}
            className="ghost-button"
            onClick={onClose}
            disabled={disabled}
            type="button"
          >
            Cancel
          </button>
          <button
            className={confirmTone === 'danger' ? 'danger-button' : 'secondary-button'}
            onClick={onConfirm}
            disabled={confirmDisabled}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
