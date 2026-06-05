import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SetupRail } from '../SetupRail.jsx'

const baseProps = {
  endpointName: 'Endpoint',
  endpointId: 'endpoint-id',
  localWebhookUrl: 'http://localhost:8080/api/hooks/endpoint-id',
  publicWebhookUrl: null,
  tunnelState: { status: 'unavailable' },
  provider: 'generic',
  onProviderChange: vi.fn(),
  razorpaySecret: '',
  razorpaySecretConfigured: false,
  onRazorpaySecretChange: vi.fn(),
  onClearRazorpaySecret: vi.fn(),
  forwardUrl: '',
  forwardState: 'idle',
  onForwardUrlChange: vi.fn(),
  onSaveForwardUrl: vi.fn(),
  onTriggerTest: vi.fn(),
  testState: 'idle',
  fixtureOptions: [],
  selectedFixtureKey: '',
  onFixtureChange: vi.fn(),
  copiedLocal: false,
  copiedPublic: false,
  onCopyLocal: vi.fn(),
  onCopyPublic: vi.fn(),
}

describe('SetupRail', () => {
  it('shows LAN-IP forward placeholder and backend forward URL warnings', () => {
    render(
      <SetupRail
        {...baseProps}
        forwardUrlWarnings={[
          'host.docker.internal only resolves on Docker Desktop. Use the host LAN IP on Linux.',
        ]}
      />,
    )

    expect(screen.getByPlaceholderText(/192\.168\.1\.42/)).toBeInTheDocument()
    expect(screen.getByText(/host\.docker\.internal only resolves/)).toBeInTheDocument()
  })
})
