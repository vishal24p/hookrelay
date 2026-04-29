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
    <section className="surface-card">
      <div className="surface-header">
        {event ? (
          <>
            <div>
              <div className="eyebrow">Event inspector</div>
              <h3 className="surface-title" style={{ marginTop: 8 }}>
                Event #{event.id}
              </h3>
              <p className="subtle-copy" style={{ marginTop: 8 }}>
                Keep the selected event stable while you inspect forwarding, payload shape, and the metadata the current backend really stores.
              </p>
            </div>
            <div className="inline-actions">
              <button className="secondary-button" onClick={() => onDownloadEvent(event)}>
                Download
              </button>
              <button
                className="primary-button"
                onClick={() => onReplayEvent(event.id)}
                disabled={replayState.status === 'loading' && replayState.eventId === event.id}
              >
                {replayState.status === 'loading' && replayState.eventId === event.id
                  ? 'Replaying…'
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
              The inspector is blank until you select a specific event from the list.
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

          <div className="surface-body">
            {activeTab === 'body' && (
              <pre className="code-block">{prettyPrintBody(event.body)}</pre>
            )}

            {activeTab === 'forward' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <div className="inline-actions">
                  <span className={`pill ${getForwardBadge(event).tone}`}>{getForwardBadge(event).label}</span>
                  {event.forwarded_at && <span className="pill">Forwarded {formatDateTime(event.forwarded_at)}</span>}
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

                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Forward response</div>
                  <pre className="code-block">{event.forward_response || 'No forward response recorded for this event.'}</pre>
                </div>

                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Forward error</div>
                  <pre className="code-block">{event.forward_error || 'No forward error recorded for this event.'}</pre>
                </div>
              </div>
            )}

            {activeTab === 'meta' && (
              <div style={{ display: 'grid', gap: 18 }}>
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

                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Headers</div>
                  <pre className="code-block">{prettyPrintObject(event.headers)}</pre>
                </div>

                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Query params</div>
                  <pre className="code-block">{prettyPrintObject(event.query_params)}</pre>
                </div>

                <div className="empty-state">
                  <h3>Schema limit</h3>
                  <p className="subtle-copy">
                    Remote IP, retry count, signature verification details, and transport timing are not available in the current event schema. This UI does not fake data that the backend never stored.
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="surface-body">
          <div className="empty-state">
            <h3>No event selected</h3>
            <p className="subtle-copy">
              Select an event from the list to inspect its raw body, forward result, and current metadata.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
