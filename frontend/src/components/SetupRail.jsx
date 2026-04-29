export function SetupRail({
  endpointName,
  endpointId,
  localWebhookUrl,
  publicWebhookUrl,
  tunnelState,
  forwardUrl,
  forwardState,
  onForwardUrlChange,
  onSaveForwardUrl,
  onTriggerTest,
  testState,
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
      <div className="row-between" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow">Endpoint workflow</div>
          <h2 className="title" style={{ marginTop: 8 }}>{endpointName}</h2>
          <p className="subtle-copy" style={{ marginTop: 8 }}>
            This screen is now ordered around the real job: expose a public URL, choose a forward target, then inspect what came in.
          </p>
        </div>
        <div className="setup-value" style={{ minWidth: 240, marginTop: 0 }}>
          <strong>Endpoint ID</strong>
          <span className="setup-url mono-text">{endpointId}</span>
        </div>
      </div>

      <div className="setup-grid">
        <section className="setup-card">
          <div className="step-badge">1. Public URL</div>
          <h3 className="setup-title">Give this to Stripe, GitHub, or any sender</h3>
          <p className="subtle-copy">
            This is the one that matters for real webhook delivery. The local URL is only for your machine.
          </p>

          <div className="setup-value">
            <strong>Public ingest</strong>
            <span className="setup-url mono-text">
              {publicWebhookUrl || 'Unavailable until the tunnel reports a public URL.'}
            </span>
          </div>

          <div className="setup-value" style={{ marginTop: 10 }}>
            <strong>Local-only URL</strong>
            <span className="setup-url secondary mono-text">{localWebhookUrl}</span>
          </div>

          <div className="copy-row">
            <button className="primary-button" onClick={onCopyPublic} disabled={!publicWebhookUrl}>
              {copiedPublic ? 'Copied Public URL' : 'Copy Public URL'}
            </button>
            <button className="ghost-button" onClick={onCopyLocal}>
              {copiedLocal ? 'Copied Local URL' : 'Copy Local URL'}
            </button>
          </div>

          <div className="status-line">
            <span className={`status-chip ${tunnelTone}`}>
              {tunnelState.status === 'ready'
                ? 'Ready'
                : tunnelState.status === 'unavailable'
                  ? 'Unavailable'
                  : tunnelState.status === 'error'
                    ? 'Error'
                    : 'Loading'}
            </span>
            <span>{tunnelState.message}</span>
          </div>
        </section>

        <section className="setup-card">
          <div className="step-badge">2. Forward To</div>
          <h3 className="setup-title">Send events into your local app</h3>
          <p className="subtle-copy">
            Use a local target like <span className="mono-text">http://host.docker.internal:3000/webhook</span> if your app runs on the host.
          </p>

          <div className="setup-value">
            <strong>Forward target</strong>
            <input
              className="text-input mono-text"
              value={forwardUrl}
              onChange={(event) => onForwardUrlChange(event.target.value)}
              placeholder="http://host.docker.internal:3000/webhooks/provider"
              style={{ marginTop: 8 }}
            />
          </div>

          <div className="copy-row">
            <button className="secondary-button" onClick={onSaveForwardUrl} disabled={forwardState === 'saving'}>
              {forwardState === 'saving'
                ? 'Saving…'
                : forwardState === 'saved'
                  ? 'Saved'
                  : 'Save Forward Target'}
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
              {forwardState === 'loading'
                ? 'Loading'
                : forwardState === 'saving'
                  ? 'Saving'
                  : forwardState === 'saved'
                    ? 'Saved'
                    : forwardState === 'error'
                      ? 'Failed'
                      : forwardUrl
                        ? 'Configured'
                        : 'Not set'}
            </span>
          </div>
        </section>

        <section className="setup-card">
          <div className="step-badge">3. Send Test</div>
          <h3 className="setup-title">Verify the whole path without leaving the dashboard</h3>
          <p className="subtle-copy">
            This posts a sample event into the current endpoint so you can confirm ingest, forwarding, and display logic immediately.
          </p>

          <div className="setup-value">
            <strong>What happens</strong>
            <span className="setup-url">
              HookRelay stores the event, pushes it to the live feed, and tries the forward target if one is configured.
            </span>
          </div>

          <div className="copy-row">
            <button className="primary-button" onClick={onTriggerTest} disabled={testState === 'loading'}>
              {testState === 'loading'
                ? 'Sending Test…'
                : testState === 'success'
                  ? 'Test Sent'
                  : 'Trigger Test Event'}
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
              {testState === 'loading'
                ? 'Sending'
                : testState === 'success'
                  ? 'Delivered'
                  : testState === 'error'
                    ? 'Failed'
                    : 'Ready'}
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}
