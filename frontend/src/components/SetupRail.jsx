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
      <div className="setup-hero">
        <div>
          <div className="eyebrow">Endpoint workflow</div>
          <h2 className="title setup-hero-title">{endpointName}</h2>
          <p className="subtle-copy" style={{ marginTop: 8 }}>
            Public ingest first. Forwarding second. Test before touching the provider.
          </p>
        </div>

        <div className="setup-hero-id">
          <span className="eyebrow">Endpoint ID</span>
          <span className="mono-text">{endpointId}</span>
        </div>
      </div>

      <div className="setup-grid compact">
        <section className="setup-card primary-setup-card">
          <div className="step-badge">1. Public URL</div>
          <h3 className="setup-title">Give this URL to the sender</h3>
          <p className="subtle-copy">
            This is the public ingest path. The local URL is only for machine-local testing.
          </p>

          <div className="setup-stack">
            <div className="setup-value focus">
              <strong>Public ingest</strong>
              <span className="setup-url mono-text">
                {publicWebhookUrl || 'Unavailable until the tunnel reports a public URL.'}
              </span>
            </div>

            <div className="setup-value compact">
              <strong>Local URL</strong>
              <span className="setup-url secondary mono-text">{localWebhookUrl}</span>
            </div>
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
          <h3 className="setup-title">Pipe events into your local app</h3>
          <p className="subtle-copy">
            If your app is running on the host, use <span className="mono-text">host.docker.internal</span>.
          </p>

          <div className="setup-value input-card">
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
                ? 'Saving...'
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
          <h3 className="setup-title">Prove the whole path now</h3>
          <p className="subtle-copy">
            This writes a sample event into the current endpoint and triggers forwarding if configured.
          </p>

          <div className="setup-value compact">
            <strong>Expected result</strong>
            <span className="setup-url">
              The feed updates immediately. If forwarding is configured, HookRelay tries it on the same pass.
            </span>
          </div>

          <div className="copy-row">
            <button className="primary-button" onClick={onTriggerTest} disabled={testState === 'loading'}>
              {testState === 'loading'
                ? 'Sending Test...'
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
