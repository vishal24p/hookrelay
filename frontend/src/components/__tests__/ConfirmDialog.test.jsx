import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../ConfirmDialog.jsx'

function renderDialog(props = {}) {
  const defaultProps = {
    open: true,
    title: 'Delete this endpoint?',
    description: 'This removes stored events.',
    confirmLabel: 'Delete endpoint',
    confirmTone: 'danger',
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    disabled: false,
  }

  return {
    ...render(<ConfirmDialog {...defaultProps} {...props} />),
    props: { ...defaultProps, ...props },
  }
}

describe('ConfirmDialog', () => {
  it('focuses the safe action on open and traps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    renderDialog({
      confirmationValue: 'endpoint-123',
      confirmationLabel: 'Endpoint ID',
    })

    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    const confirmationInput = screen.getByLabelText(/type endpoint-123 to confirm/i)

    await waitFor(() => expect(cancelButton).toHaveFocus())

    await user.tab()
    expect(confirmationInput).toHaveFocus()

    await user.tab({ shift: true })
    expect(cancelButton).toHaveFocus()
  })

  it('closes on Escape when not disabled', () => {
    const onClose = vi.fn()
    renderDialog({ onClose })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close from backdrop or Escape while disabled', () => {
    const onClose = vi.fn()
    renderDialog({ disabled: true, onClose })

    fireEvent.click(screen.getByLabelText(/close dialog/i))
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('requires the endpoint id before confirming destructive deletes', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderDialog({
      confirmationValue: 'endpoint-123',
      confirmationLabel: 'Endpoint ID',
      onConfirm,
    })

    const confirmButton = screen.getByRole('button', { name: /delete endpoint/i })
    expect(confirmButton).toBeDisabled()

    await user.type(screen.getByLabelText(/type endpoint-123 to confirm/i), 'endpoint-123')
    expect(confirmButton).toBeEnabled()

    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
