import { formatRelative, formatTime, getEventSize, getForwardBadge } from '../ui.js'

function getPreview(body) {
  if (body == null) return 'No payload body'
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return raw.length > 100 ? `${raw.slice(0, 100)}...` : raw
}

export function EventList({
  events,
  selectedEventId,
  onSelectEvent,
  loadingHistory,
  clearState,
  onRequestClear,
  endpointSource,
  tunnelReady,
}) {
  return (
    <section className="surface-card">
      <div className="surface-header">
        <div>
          <div className="eyebrow">Events</div>
          <h3 className="surface-title" style={{ marginTop: 8 }}>
            {events.length} captured
          </h3>
        </div>
        <button
          className="ghost-button"
          onClick={onRequestClear}
          disabled={clearState === 'loading' || events.length === 0}
        >
          {clearState === 'loading' ? 'Clearing...' : 'Clear Feed'}
        </button>
      </div>

      <div className="surface-body">
        {loadingHistory ? (
          <div className="empty-state">
            <h3>Loading endpoint history</h3>
            <p className="subtle-copy">HookRelay is fetching stored events for this endpoint.</p>
          </div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            {endpointSource === 'server' ? (
              <>
                <h3>No events yet</h3>
                <p className="subtle-copy">
                  Send a fixture or point Razorpay at the public URL. Captured events appear here
                  with signature and delivery status.
                </p>
                {!tunnelReady ? (
                  <p className="helper-note" style={{ marginTop: 14 }}>
                    The tunnel is not ready yet. Forwarding can still be configured now.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <h3>No events yet</h3>
                <p className="subtle-copy">
                  Send a fixture or point Razorpay at the public URL. Captured events appear here
                  with signature and delivery status.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="event-table">
            <div className="event-table-body">
              {events.map((event) => {
                const badge = getForwardBadge(event)
                const isSelected = event.id === selectedEventId

                return (
                  <button
                    key={event.id}
                    className={`event-row ${isSelected ? 'active' : ''}`}
                    onClick={() => onSelectEvent(event.id)}
                  >
                    <div className="event-row-top">
                      <div className="event-row-main">
                        <div className="event-row-title">
                          <span>{event.provider_event_type || event.method}</span>
                          {event.method === 'REPLAY' ? (
                            <span className="pill replay">Replay</span>
                          ) : null}
                          {event.is_local_fixture ? (
                            <span className="pill warning">Local fixture</span>
                          ) : null}
                          <span className={`pill ${badge.tone}`}>{badge.label}</span>
                        </div>
                        <div className="event-row-subtitle">Event #{event.id}</div>
                      </div>

                      <div className="event-row-metrics">
                        <span className="event-metric">{formatTime(event.received_at)}</span>
                        <span className="event-metric">{getEventSize(event)}</span>
                      </div>
                    </div>

                    <div className="event-row-bottom">
                      <span className="event-preview mono-text">{getPreview(event.body)}</span>
                      <span className="event-age">{formatRelative(event.received_at)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
