export function SetupRail({
  endpointName,
  endpointId,
  localWebhookUrl,
  publicWebhookUrl,
  tunnelState,
  provider,
  onProviderChange,
  razorpaySecret,
  razorpaySecretConfigured,
  onRazorpaySecretChange,
  onClearRazorpaySecret,
  forwardUrl,
  forwardState,
  onForwardUrlChange,
  onSaveForwardUrl,
  onTriggerTest,
  testState,
  fixtureOptions,
  selectedFixtureKey,
  onFixtureChange,
  copiedLocal,
  copiedPublic,
  onCopyLocal,
  onCopyPublic,
}) {
  const tunnelTone =
    tunnelState.status === 'ready'
      ? 'ready'
      : tunnelState.status === 'error'
        ? 'error'
        : tunnelState.status === 'unavailable'
          ? 'warning'
          : 'info'

  return (
    <div className="setup-wrap">
      <div className="setup-hero">
        <div>
          <div className="eyebrow">Setup</div>
          <h2 className="title setup-hero-title">Razorpay webhook test path</h2>
          <p className="subtle-copy" style={{ marginTop: 8 }}>
            Only configure what is needed to receive, verify, forward, and replay events.
          </p>
        </div>

        <div className="setup-hero-id">
          <span className="eyebrow">Endpoint</span>
          <span>{endpointName}</span>
          <span className="mono-text">{endpointId}</span>
        </div>
      </div>

      <div className="setup-strip">
        <section className="setup-step">
          <div className="step-label">1 Public URL</div>
          <p className="setup-primary mono-text">
            {publicWebhookUrl || 'Tunnel pending'}
          </p>
          <p className="setup-secondary mono-text">Local: {localWebhookUrl}</p>
          <div className="setup-actions">
            <button className="secondary-button compact-button" onClick={onCopyPublic} disabled={!publicWebhookUrl}>
              {copiedPublic ? 'Copied' : 'Copy URL'}
            </button>
            <button className="ghost-button compact-button" onClick={onCopyLocal}>
              {copiedLocal ? 'Copied local' : 'Copy local'}
            </button>
            <span className={`status-chip ${tunnelTone}`}>
              {tunnelState.status === 'ready' ? 'Ready' : 'Waiting'}
            </span>
          </div>
        </section>

        <section className="setup-step">
          <div className="step-label">2 Provider</div>
          <select
            className="text-input compact-input"
            value={provider}
            onChange={(event) => onProviderChange(event.target.value)}
          >
            <option value="razorpay">Razorpay</option>
            <option value="generic">Generic webhook</option>
          </select>
          {provider === 'razorpay' ? (
            <>
              <input
                className="text-input compact-input mono-text"
                value={razorpaySecret}
                onChange={(event) => onRazorpaySecretChange(event.target.value)}
                placeholder={razorpaySecretConfigured ? 'Secret configured' : 'Webhook secret'}
                type="password"
              />
              <div className="setup-actions">
                <span className={`status-chip ${razorpaySecretConfigured ? 'ready' : 'warning'}`}>
                  {razorpaySecretConfigured ? 'Secret set' : 'Secret not set'}
                </span>
                <button
                  className="ghost-button compact-button"
                  onClick={onClearRazorpaySecret}
                  disabled={!razorpaySecretConfigured || forwardState === 'saving'}
                >
                  Clear
                </button>
              </div>
            </>
          ) : (
            <p className="setup-secondary">Raw capture, forwarding, replay.</p>
          )}
        </section>

        <section className="setup-step">
          <div className="step-label">3 Forward target</div>
          <input
            className="text-input compact-input mono-text"
            value={forwardUrl}
            onChange={(event) => onForwardUrlChange(event.target.value)}
            placeholder="http://host.docker.internal:3000/webhooks/razorpay"
          />
          <div className="setup-actions">
            <button className="secondary-button compact-button" onClick={onSaveForwardUrl} disabled={forwardState === 'saving'}>
              {forwardState === 'saving' ? 'Saving...' : forwardState === 'saved' ? 'Saved' : 'Save'}
            </button>
            <span className={`status-chip ${
              forwardState === 'error'
                ? 'error'
                : forwardState === 'saved'
                  ? 'ready'
                  : forwardState === 'loading'
                    ? 'info'
                    : 'warning'
            }`}>
              {forwardUrl ? 'Configured' : 'Not set'}
            </span>
          </div>
        </section>

        <section className="setup-step">
          <div className="step-label">4 Test fixture</div>
          {provider === 'razorpay' ? (
            <select
              className="text-input compact-input"
              value={selectedFixtureKey}
              onChange={(event) => onFixtureChange(event.target.value)}
            >
              {fixtureOptions.map((fixture) => (
                <option key={fixture.key} value={fixture.key}>{fixture.label}</option>
              ))}
            </select>
          ) : (
            <p className="setup-secondary">Generic test payload.</p>
          )}
          <div className="setup-actions">
            <button className="primary-button compact-button" onClick={onTriggerTest} disabled={testState === 'loading'}>
              {testState === 'loading'
                ? 'Sending...'
                : testState === 'success'
                  ? 'Sent'
                  : provider === 'razorpay' ? 'Send fixture' : 'Send test'}
            </button>
            <span className={`status-chip ${
              testState === 'success'
                ? 'ready'
                : testState === 'error'
                  ? 'error'
                  : testState === 'loading'
                    ? 'info'
                    : 'warning'
            }`}>
              {testState === 'success' ? 'Delivered' : testState === 'error' ? 'Failed' : 'Ready'}
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}
