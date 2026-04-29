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
  endpointName,
  endpointSource,
  tunnelReady,
}) {
  return (
    <section className="surface-card">
      <div className="surface-header">
        <div>
          <div className="eyebrow">Incoming events</div>
          <h3 className="surface-title" style={{ marginTop: 8 }}>{events.length} events captured</h3>
          <p className="subtle-copy" style={{ marginTop: 8 }}>
            Scan first. Inspect second. The feed should behave like a debugger list, not a gallery.
          </p>
        </div>
        <button className="ghost-button" onClick={onRequestClear} disabled={clearState === 'loading' || events.length === 0}>
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
                <h3>No events yet for {endpointName}</h3>
                <p className="subtle-copy">
                  This endpoint exists on the backend, but nothing has hit it yet.
                </p>
                <ol>
                  <li>Copy the public ingest URL if a third-party service needs to send a webhook.</li>
                  <li>Set the forward target if you want HookRelay to hand payloads to your local app.</li>
                  <li>Trigger a test event here before blaming the provider.</li>
                </ol>
                {!tunnelReady ? (
                  <p className="helper-note" style={{ marginTop: 14 }}>
                    The tunnel is not ready yet. Forwarding can still be configured now.
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <h3>{endpointName} is still a draft</h3>
                <p className="subtle-copy">
                  The browser remembers this ID, but the backend has never persisted it.
                </p>
                <ol>
                  <li>Send a test event or point a provider at the public URL.</li>
                  <li>The first real event will promote this draft into a saved endpoint.</li>
                  <li>If you do not need it, forget it from the browser pane.</li>
                </ol>
              </>
            )}
          </div>
        ) : (
          <div className="event-table">
            <div className="event-table-header">
              <span>Method</span>
              <span>Status</span>
              <span>Received</span>
              <span>Size</span>
            </div>

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
                          <span className="pill method">{event.method}</span>
                          {event.method === 'REPLAY' ? <span className="pill replay">Replay</span> : null}
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
