import {
  formatDateTime,
  getForwardBadge,
  getSignatureBadge,
  prettyPrintBody,
  prettyPrintObject,
} from '../ui.js'

export function kindToLabel(kind) {
  switch (kind) {
    case 'timeout':
      return 'Forward timed out'
    case 'connection':
      return 'Connection refused'
    case 'tls':
      return 'TLS handshake failed'
    case 'dns':
      return 'DNS lookup failed'
    case 'invalid_url':
      return 'Invalid URL'
    case 'other':
    default:
      return 'Forward failed'
  }
}

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
  const duplicateLabel = event?.duplicate_of_id
    ? event.method === 'REPLAY'
      ? 'Replay duplicate test'
      : 'Duplicate delivery'
    : event?.provider_event_id
      ? 'No duplicate found'
      : 'Duplicate check unavailable'

  const duplicateMessage = event?.duplicate_of_id
    ? `Same Razorpay event ID as Event #${event.duplicate_of_id}.`
    : event?.provider_event_id
      ? 'No earlier event on this endpoint has the same Razorpay event ID.'
      : 'Razorpay event ID is missing, so HookRelay cannot compare deliveries.'
  const forwardBadge = getForwardBadge(event)
  const forwardMessage =
    event?.forward_delivery_message || 'No forwarding diagnostics recorded for this event.'
  const replayMessage =
    event?.method === 'REPLAY'
      ? 'Replay sent the stored body, headers, and query params from the original event.'
      : null
  const replayDeliveryFailed =
    replayState?.status === 'success' &&
    replayState?.eventId === event?.id &&
    replayState?.delivery === 'failed'

  return (
    <section className="surface-card inspector-card">
      <div className="surface-header inspector-header">
        {event ? (
          <>
            <div>
              <div className="eyebrow">Inspector</div>
              <h3 className="surface-title" style={{ marginTop: 8 }}>
                Event #{event.id}
              </h3>
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
                    ? replayState.delivery === 'failed'
                      ? 'Replay failed'
                      : 'Replayed'
                    : 'Replay'}
              </button>
            </div>
          </>
        ) : (
          <div>
            <div className="eyebrow">Inspector</div>
            <h3 className="surface-title" style={{ marginTop: 8 }}>
              Pick an event
            </h3>
            <p className="subtle-copy" style={{ marginTop: 8 }}>
              Show only fields needed to debug delivery.
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
                  <span className={`pill ${forwardBadge.tone}`}>{forwardBadge.label}</span>
                  {event.forwarded_at ? (
                    <span className="pill">Forwarded {formatDateTime(event.forwarded_at)}</span>
                  ) : null}
                  {event.forward_failure_kind ? (
                    <span
                      className="pill error"
                      role="status"
                      title={event.forward_delivery_message || ''}
                    >
                      {kindToLabel(event.forward_failure_kind)}
                    </span>
                  ) : null}
                  {replayMessage ? <span className="pill warning">Replay delivery</span> : null}
                  {replayDeliveryFailed ? (
                    <span className="pill error" role="status" aria-live="polite">
                      Replay failed - local handler unreachable
                    </span>
                  ) : null}
                </div>
                <p className={`diagnostic-note ${forwardBadge.tone}`}>{forwardMessage}</p>
                {replayMessage ? <p className="diagnostic-note warning">{replayMessage}</p> : null}

                <div className="meta-grid">
                  <div className="meta-pill">
                    <span className="meta-label">Forward status</span>
                    <span className="meta-value">{event.forward_status ?? 'Not available'}</span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-label">Delivery result</span>
                    <span className="meta-value">
                      {event.forward_delivery_status || 'not_forwarded'}
                    </span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-label">Forwarded at</span>
                    <span className="meta-value">{formatDateTime(event.forwarded_at)}</span>
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="eyebrow inspector-section-title">Forward response</div>
                  <pre className="code-block">
                    {event.forward_response || 'No forward response recorded for this event.'}
                  </pre>
                </div>

                <div className="inspector-section">
                  <div className="eyebrow inspector-section-title">Forward error</div>
                  <pre className="code-block">
                    {event.forward_error || 'No forward error recorded for this event.'}
                  </pre>
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
                  <div className="meta-pill">
                    <span className="meta-label">Fixture</span>
                    <span className="meta-value">
                      {event.is_local_fixture ? 'Local fixture' : 'Provider delivery'}
                    </span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-label">Fixture key</span>
                    <span className="meta-value mono-text">
                      {event.fixture_key || 'Not available'}
                    </span>
                  </div>
                </div>

                <div className="inspector-section">
                  <div className="eyebrow inspector-section-title">Razorpay diagnostics</div>
                  <div className="meta-grid">
                    <div className="meta-pill">
                      <span className="meta-label">Provider mode</span>
                      <span className="meta-value">{event.provider || 'generic'}</span>
                    </div>
                    <div className="meta-pill">
                      <span className="meta-label">Event type</span>
                      <span className="meta-value">
                        {event.provider_event_type || 'Not available'}
                      </span>
                    </div>
                    <div className="meta-pill">
                      <span className="meta-label">Provider event ID</span>
                      <span className="meta-value mono-text">
                        {event.provider_event_id || 'Not available'}
                      </span>
                    </div>
                    <div className="meta-pill">
                      <span className="meta-label">Duplicate check</span>
                      <span className="meta-value">{duplicateLabel}</span>
                    </div>
                    <div className="meta-pill">
                      <span className="meta-label">Payment ID</span>
                      <span className="meta-value mono-text">
                        {event.razorpay_payment_id || 'Not available'}
                      </span>
                    </div>
                    <div className="meta-pill">
                      <span className="meta-label">Order ID</span>
                      <span className="meta-value mono-text">
                        {event.razorpay_order_id || 'Not available'}
                      </span>
                    </div>
                    <div className="meta-pill">
                      <span className="meta-label">Refund ID</span>
                      <span className="meta-value mono-text">
                        {event.razorpay_refund_id || 'Not available'}
                      </span>
                    </div>
                    <div className="meta-pill">
                      <span className="meta-label">Subscription ID</span>
                      <span className="meta-value mono-text">
                        {event.razorpay_subscription_id || 'Not available'}
                      </span>
                    </div>
                  </div>
                  <div className="inspector-summary-strip" style={{ marginTop: 12 }}>
                    <span className={`pill ${getSignatureBadge(event).tone}`}>
                      {getSignatureBadge(event).label}
                    </span>
                    <span className="pill">
                      {event.signature_message || 'No signature diagnostics recorded.'}
                    </span>
                    {event.duplicate_of_id ? (
                      <span className="pill warning">{duplicateMessage}</span>
                    ) : (
                      <span className="pill">{duplicateMessage}</span>
                    )}
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
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="surface-body">
          <div className="empty-state">
            <h3>No event selected</h3>
            <p className="subtle-copy">Select an event from the list.</p>
          </div>
        </div>
      )}
    </section>
  )
}
