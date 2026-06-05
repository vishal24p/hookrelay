import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StatusBanner } from '../StatusBanner.jsx'

describe('StatusBanner', () => {
  it('renders and invokes warning banner actions', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()

    render(
      <StatusBanner
        banners={[
          {
            tone: 'warning',
            message: 'Local browser storage is full or unavailable.',
            action: { label: 'Dismiss', onClick },
          },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
