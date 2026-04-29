import { formatRelative } from '../ui.js'

function getSourceLabel(endpoint) {
  if (endpoint?.source === 'server') return 'Saved'
  if (endpoint?.source === 'current_unsaved') return 'Current draft'
  return 'Local only'
}

export function EndpointSidebar({
  serverEndpoints,
  localEndpoints,
  sessionId,
  currentEndpoint,
  sessionsLoading,
  searchQuery,
  setSearchQuery,
  createFormOpen,
  setCreateFormOpen,
  createName,
  setCreateName,
  createId,
  setCreateId,
  onCreateEndpoint,
  onSelectEndpoint,
  onRequestDelete,
  onForgetLocal,
  onCopyEndpointId,
  copiedEndpointId,
  connected,
}) {
  function renderEndpointCard(endpoint) {
    const isCurrent = endpoint.id === sessionId
    const allowDelete = endpoint.source === 'server'
    const allowForget = endpoint.source === 'local_history'

    return (
      <div
        key={endpoint.id}
        className={`endpoint-card ${isCurrent ? 'active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelectEndpoint(endpoint.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelectEndpoint(endpoint.id)
          }
        }}
      >
        <div className="endpoint-header">
          <div style={{ minWidth: 0 }}>
            <p className="endpoint-name">{endpoint.name}</p>
            <p className="endpoint-id">{endpoint.id}</p>
          </div>
          <div className={`dot ${isCurrent && connected ? 'live' : ''}`} />
        </div>

        <div className="inline-actions" style={{ marginBottom: 12 }}>
          <span className={`source-pill ${endpoint.source === 'server' ? 'saved' : 'local'}`}>
            {getSourceLabel(endpoint)}
          </span>
        </div>

        <div className="meta-row">
          <div className="meta-pill">
            <span className="meta-label">Events</span>
            <span className="meta-value">
              {endpoint.source === 'server'
                ? endpoint.count
                : endpoint.count > 0
                  ? endpoint.count
                  : 'Not persisted yet'}
            </span>
          </div>
          <div className="meta-pill">
            <span className="meta-label">Last activity</span>
            <span className="meta-value">
              {endpoint.source === 'server'
                ? formatRelative(endpoint.lastActivity)
                : endpoint.lastActivity
                  ? formatRelative(endpoint.lastActivity)
                  : 'Not persisted yet'}
            </span>
          </div>
        </div>

        <div className="inline-actions" style={{ marginTop: 12 }}>
          <button
            className="ghost-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onCopyEndpointId(endpoint.id)
            }}
          >
            {copiedEndpointId === endpoint.id ? 'Copied ID' : 'Copy ID'}
          </button>

          {allowDelete ? (
            <button
              className="danger-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRequestDelete(endpoint.id)
              }}
            >
              Delete
            </button>
          ) : null}

          {allowForget ? (
            <button
              className="ghost-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onForgetLocal(endpoint.id)
              }}
            >
              Forget
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <>
      <section className="sidebar-section">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <div>
            <div className="eyebrow">Endpoints</div>
            <p className="subtle-copy" style={{ marginTop: 6 }}>
              Sessions are now treated like named local endpoints. Names stay in this browser.
            </p>
          </div>
          <button className="primary-button" onClick={() => setCreateFormOpen((prev) => !prev)}>
            {createFormOpen ? 'Close' : 'New Endpoint'}
          </button>
        </div>

        <input
          className="search-input"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Filter endpoints by name or ID"
        />

        {createFormOpen && (
          <div className="sidebar-form">
            <input
              className="text-input"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Endpoint name"
            />
            <input
              className="text-input"
              value={createId}
              onChange={(event) => setCreateId(event.target.value)}
              placeholder="Custom endpoint ID (optional)"
            />
            <div className="inline-actions">
              <button className="primary-button" onClick={onCreateEndpoint}>
                Create Endpoint
              </button>
              <button className="ghost-button" onClick={() => setCreateFormOpen(false)}>
                Cancel
              </button>
            </div>
            <div className="helper-note">
              Leave the ID blank if you want HookRelay to generate one automatically.
            </div>
          </div>
        )}
      </section>

      <section className="sidebar-section" style={{ paddingTop: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="row-between" style={{ marginBottom: 14 }}>
          <div>
            <div className="eyebrow">Saved Endpoints</div>
            <p className="subtle-copy" style={{ marginTop: 6 }}>
              {sessionsLoading ? 'Refreshing saved endpoint state...' : `${serverEndpoints.length} server-backed endpoints.`}
            </p>
          </div>
          <div className={`status-chip ${connected ? 'ready' : 'warning'}`}>
            {connected ? 'Live stream connected' : 'Reconnecting'}
          </div>
        </div>

        <div className="endpoint-list">
          {serverEndpoints.map(renderEndpointCard)}

          {serverEndpoints.length === 0 && (
            <div className="empty-state">
              <h3>No saved endpoints yet</h3>
              <p className="subtle-copy">
                Saved endpoints appear here only after HookRelay has actually seen them on the backend.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="sidebar-section" style={{ paddingTop: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="row-between" style={{ marginBottom: 14 }}>
          <div>
            <div className="eyebrow">Local Drafts</div>
            <p className="subtle-copy" style={{ marginTop: 6 }}>
              {localEndpoints.length
                ? `${localEndpoints.length} local-only endpoint IDs in this browser.`
                : 'No local-only endpoint IDs right now.'}
            </p>
          </div>
        </div>

        <div className="endpoint-list" style={{ marginTop: 0 }}>
          {localEndpoints.map(renderEndpointCard)}
        </div>
      </section>

      <section className="sidebar-section">
        <div className="eyebrow">Current Endpoint</div>
        <p className="endpoint-name" style={{ marginTop: 10 }}>{currentEndpoint?.name || sessionId}</p>
        <p className="endpoint-id">{sessionId}</p>
        <div className="inline-actions" style={{ marginTop: 10 }}>
          <span className={`source-pill ${currentEndpoint?.source === 'server' ? 'saved' : 'local'}`}>
            {getSourceLabel(currentEndpoint)}
          </span>
        </div>
        <div className="helper-note" style={{ marginTop: 10 }}>
          Technical IDs stay compatible with the existing URL hash model. Saved means server-backed. Local only means this browser remembers the ID, but the backend does not.
        </div>
      </section>
    </>
  )
}
