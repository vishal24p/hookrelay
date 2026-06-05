import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EventInspector, kindToLabel } from '../EventInspector.jsx'

const event = {
  id: 'evt-1',
  method: 'POST',
  body: '{}',
  headers: {},
  query_params: {},
  received_at: '2026-06-04T12:00:00.000Z',
  forward_delivery_status: 'failed',
  forward_failure_kind: 'dns',
  forward_delivery_message: 'DNS lookup failed for local handler.',
}

describe('EventInspector', () => {
  it('maps forward failure kinds to readable labels', () => {
    expect(kindToLabel('timeout')).toBe('Forward timed out')
    expect(kindToLabel('connection')).toBe('Connection refused')
    expect(kindToLabel('tls')).toBe('TLS handshake failed')
    expect(kindToLabel('dns')).toBe('DNS lookup failed')
    expect(kindToLabel('invalid_url')).toBe('Invalid URL')
    expect(kindToLabel('other')).toBe('Forward failed')
  })

  it('renders forward failure kind and replay delivery failure pills', () => {
    render(
      <EventInspector
        event={event}
        activeTab="forward"
        onChangeTab={vi.fn()}
        onReplayEvent={vi.fn()}
        onDownloadEvent={vi.fn()}
        replayState={{ status: 'success', eventId: 'evt-1', delivery: 'failed' }}
      />,
    )

    expect(screen.getByText('DNS lookup failed')).toBeInTheDocument()
    expect(screen.getByText('Replay failed - local handler unreachable')).toBeInTheDocument()
  })
})
