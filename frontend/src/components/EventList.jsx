import { formatRelative, formatTime, getEventSize, getForwardBadge } from '../ui.js'

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
            Scan the list on the left. Inspect the selected event on the right.
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
                  The old UI forced you to guess the next step. This one does not.
                </p>
                <ol>
                  <li>Copy the public ingest URL if you want a third-party service to hit this endpoint.</li>
                  <li>Set a forward target if you want the payload relayed to your local app.</li>
                  <li>Trigger a test event here to prove the entire workflow before touching the provider.</li>
                </ol>
                {!tunnelReady && (
                  <p className="helper-note" style={{ marginTop: 14 }}>
                    Public ingest is not ready yet. You can still set forwarding and wait for the tunnel to come up.
                  </p>
                )}
              </>
            ) : (
              <>
                <h3>{endpointName} is still local-only</h3>
                <p className="subtle-copy">
                  This ID exists in the browser, but HookRelay has not persisted it as a real saved endpoint yet.
                </p>
                <ol>
                  <li>Send a test event or point a provider at the public URL.</li>
                  <li>Once HookRelay receives a real event, this endpoint will move into Saved Endpoints.</li>
                  <li>If you do not need it, forget it from the Local Drafts section.</li>
                </ol>
              </>
            )}
          </div>
        ) : (
          <div className="event-list">
            {events.map((event) => {
              const badge = getForwardBadge(event)
              const isSelected = event.id === selectedEventId
              return (
                <button
                  key={event.id}
                  className={`event-row ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectEvent(event.id)}
                >
                  <div className="pill-row">
                    <span className="pill method">{event.method}</span>
                    {event.method === 'REPLAY' && <span className="pill replay">Replay</span>}
                    <span className={`pill ${badge.tone}`}>{badge.label}</span>
                  </div>

                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="endpoint-name" style={{ marginBottom: 6 }}>
                        Event #{event.id}
                      </div>
                      <div className="endpoint-id">Received {formatTime(event.received_at)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="endpoint-name" style={{ fontSize: 12, marginBottom: 6 }}>
                        {getEventSize(event)}
                      </div>
                      <div className="endpoint-id">{formatRelative(event.received_at)}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
