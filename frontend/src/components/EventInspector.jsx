import {
  formatDateTime,
  getForwardBadge,
  prettyPrintBody,
  prettyPrintObject,
} from '../ui.js'

export function EventInspector({
  event,
  activeTab,
  onChangeTab,
  onReplayEvent,
  onDownloadEvent,
  replayState,
}) {
  const tabs = [
    ['body', 'Body'],
    ['forward', 'Forward Result'],
    ['meta', 'Meta'],
  ]

  return (
    <section className="surface-card inspector-card">
      <div className="surface-header inspector-header">
        {event ? (
          <>
            <div>
              <div className="eyebrow">Event inspector</div>
              <h3 className="surface-title" style={{ marginTop: 8 }}>
                Event #{event.id}
              </h3>
              <p className="subtle-copy" style={{ marginTop: 8 }}>
                Inspect the raw body, forwarding result, and the actual metadata the backend stores.
              </p>
            </div>
            <div className="inline-actions inspector-actions">
              <button className="secondary-button" onClick={() => onDownloadEvent(event)}>
                Download
              </button>
              <button
                className="primary-button"
                onClick={() => onReplayEvent(event.id)}
                disabled={replayState.status === 'loading' && replayState.eventId === event.id}
              >
                {replayState.status === 'loading' && replayState.eventId === event.id
                  ? 'Replaying...'
                  : replayState.status === 'success' && replayState.eventId === event.id
                    ? 'Replayed'
                    : 'Replay Event'}
              </button>
            </div>
          </>
        ) : (
          <div>
            <div className="eyebrow">Event inspector</div>
            <h3 className="surface-title" style={{ marginTop: 8 }}>Pick an event</h3>
            <p className="subtle-copy" style={{ marginTop: 8 }}>
              The inspector stays blank until you select something real from the feed.
            </p>
          </div>
        )}
      </div>

      {event ? (
        <>
          <div className="inspector-tabs">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                className={`tab-button ${activeTab === key ? 'active' : ''}`}
                onClick={() => onChangeTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="surface-body inspector-body">
            {activeTab === 'body' ? (
              <pre className="code-block">{prettyPrintBody(event.body)}</pre>
            ) : null}

            {activeTab === 'forward' ? (
              <div className="inspector-section-stack">
                <div className="inspector-summary-strip">
                  <span className={`pill ${getForwardBadge(event).tone}`}>{getForwardBadge(event).label}</span>
                  {event.forwarded_at ? <span className="pill">Forwarded {formatDateTime(event.forwarded_at)}</span> : null}
                </div>

                <div className="meta-grid">
                  <div className="meta-pill">
                    <span className="meta-label">Forward status</span>
                    <span className="meta-value">{event.forward_status ?? 'Not available'}</span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-label">Forwarded at</span>
                    <span className="meta-value">{formatDateTime(event.forwarded_at)}</span>
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="eyebrow inspector-section-title">Forward response</div>
                  <pre className="code-block">{event.forward_response || 'No forward response recorded for this event.'}</pre>
                </div>

                <div className="inspector-section">
                  <div className="eyebrow inspector-section-title">Forward error</div>
                  <pre className="code-block">{event.forward_error || 'No forward error recorded for this event.'}</pre>
                </div>
              </div>
            ) : null}

            {activeTab === 'meta' ? (
              <div className="inspector-section-stack">
                <div className="meta-grid">
                  <div className="meta-pill">
                    <span className="meta-label">Method</span>
                    <span className="meta-value">{event.method}</span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-label">Received at</span>
                    <span className="meta-value">{formatDateTime(event.received_at)}</span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-label">Session ID</span>
                    <span className="meta-value mono-text">{event.session_id}</span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-label">Event ID</span>
                    <span className="meta-value mono-text">{event.id}</span>
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="eyebrow inspector-section-title">Headers</div>
                  <pre className="code-block">{prettyPrintObject(event.headers)}</pre>
                </div>

                <div className="inspector-section">
                  <div className="eyebrow inspector-section-title">Query params</div>
                  <pre className="code-block">{prettyPrintObject(event.query_params)}</pre>
                </div>

                <div className="empty-state">
                  <h3>Schema limit</h3>
                  <p className="subtle-copy">
                    Remote IP, retry count, signature verification details, and transport timing are not available in the current event schema. This UI does not invent data.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="surface-body">
          <div className="empty-state">
            <h3>No event selected</h3>
            <p className="subtle-copy">
              Select an event from the list to inspect its raw body, forward result, and stored metadata.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
