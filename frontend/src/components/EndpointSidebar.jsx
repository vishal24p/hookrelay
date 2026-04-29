import { useMemo, useState } from 'react'
import { formatRelative } from '../ui.js'

function getSourceLabel(endpoint) {
  if (endpoint?.source === 'server') return 'Saved'
  if (endpoint?.source === 'current_unsaved') return 'Current draft'
  return 'Local only'
}

function getEventCountLabel(endpoint) {
  if (endpoint?.source === 'server') return `${endpoint.count} events`
  if (endpoint?.count > 0) return `${endpoint.count} events`
  return 'Pending'
}

function getLastActivityLabel(endpoint) {
  if (endpoint?.lastActivity) return formatRelative(endpoint.lastActivity)
  return 'Not persisted yet'
}

function sortEndpoints(endpoints, mode, sessionId) {
  return [...endpoints].sort((left, right) => {
    if (left.id === sessionId) return -1
    if (right.id === sessionId) return 1

    if (mode === 'name') {
      return left.name.localeCompare(right.name)
    }

    const leftTime = left.lastActivity ? new Date(left.lastActivity).getTime() : 0
    const rightTime = right.lastActivity ? new Date(right.lastActivity).getTime() : 0
    return rightTime - leftTime
  })
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
  const [filterMode, setFilterMode] = useState('all')
  const [sortMode, setSortMode] = useState('activity')

  const filteredServerEndpoints = useMemo(
    () => sortEndpoints(serverEndpoints, sortMode, sessionId),
    [serverEndpoints, sortMode, sessionId],
  )

  const filteredLocalEndpoints = useMemo(
    () => sortEndpoints(localEndpoints, sortMode, sessionId),
    [localEndpoints, sortMode, sessionId],
  )

  const showSaved = filterMode === 'all' || filterMode === 'saved'
  const showDrafts = filterMode === 'all' || filterMode === 'draft'

  function renderEndpointRow(endpoint) {
    const isCurrent = endpoint.id === sessionId
    const allowDelete = endpoint.source === 'server'
    const allowForget = endpoint.source === 'local_history'

    return (
      <div
        key={endpoint.id}
        className={`endpoint-browser-row ${isCurrent ? 'active' : ''}`}
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
        <div className="endpoint-browser-rowhead">
          <div className="endpoint-browser-nameblock">
            <div className="endpoint-browser-titleline">
              <span className="endpoint-name">{endpoint.name}</span>
              {isCurrent ? <span className="current-tag">Current</span> : null}
            </div>
            <div className="endpoint-id">{endpoint.id}</div>
          </div>

          <div className="endpoint-browser-actions">
            <button
              className="row-action-button"
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onCopyEndpointId(endpoint.id)
              }}
            >
              {copiedEndpointId === endpoint.id ? 'Copied' : 'ID'}
            </button>

            {allowDelete ? (
              <button
                className="row-action-button danger"
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
                className="row-action-button"
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

        <div className="endpoint-browser-meta">
          <span className={`source-pill ${endpoint.source === 'server' ? 'saved' : 'local'}`}>
            {getSourceLabel(endpoint)}
          </span>
          <span className="endpoint-browser-fact">{getEventCountLabel(endpoint)}</span>
          <span className="endpoint-browser-fact">{getLastActivityLabel(endpoint)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="session-browser-shell">
      <section className="sidebar-section browser-toolbar">
        <div className="row-between browser-toolbar-top">
          <div>
            <div className="eyebrow">Session browser</div>
            <p className="subtle-copy" style={{ marginTop: 6 }}>
              Real saved endpoints first. Local drafts second.
            </p>
          </div>
          <button className="primary-button" onClick={() => setCreateFormOpen((prev) => !prev)}>
            {createFormOpen ? 'Close' : 'New Endpoint'}
          </button>
        </div>

        <div className="browser-search-row">
          <input
            className="search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name or ID"
          />

          <select
            className="browser-sort"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
            aria-label="Sort endpoints"
          >
            <option value="activity">Recent first</option>
            <option value="name">Name</option>
          </select>
        </div>

        <div className="browser-filter-row" role="tablist" aria-label="Endpoint filters">
          {[
            ['all', 'All'],
            ['saved', 'Saved'],
            ['draft', 'Draft'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`filter-chip ${filterMode === value ? 'active' : ''}`}
              onClick={() => setFilterMode(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {createFormOpen ? (
          <div className="sidebar-form browser-create-form">
            <input
              className="text-input"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Endpoint name"
            />
            <input
              className="text-input mono-text"
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
        ) : null}
      </section>

      <section className="sidebar-section browser-table-shell">
        <div className="browser-status-row">
          <div>
            <div className="eyebrow">Endpoint inventory</div>
            <p className="subtle-copy" style={{ marginTop: 6 }}>
              {sessionsLoading
                ? 'Refreshing saved endpoint state...'
                : `${serverEndpoints.length} saved, ${localEndpoints.length} local drafts.`}
            </p>
          </div>
          <div className={`status-chip ${connected ? 'ready' : 'warning'}`}>
            {connected ? 'Stream live' : 'Reconnecting'}
          </div>
        </div>

        <div className="endpoint-browser">
          {showSaved ? (
            <div className="endpoint-browser-group">
              <div className="endpoint-browser-grouphead">
                <span>Saved Endpoints</span>
                <span>{filteredServerEndpoints.length}</span>
              </div>
              {filteredServerEndpoints.length ? (
                filteredServerEndpoints.map(renderEndpointRow)
              ) : (
                <div className="browser-empty">
                  Saved endpoints appear here only after the backend has actually seen them.
                </div>
              )}
            </div>
          ) : null}

          {showDrafts ? (
            <div className="endpoint-browser-group">
              <div className="endpoint-browser-grouphead">
                <span>Local Drafts</span>
                <span>{filteredLocalEndpoints.length}</span>
              </div>
              {filteredLocalEndpoints.length ? (
                filteredLocalEndpoints.map(renderEndpointRow)
              ) : (
                <div className="browser-empty">
                  No local-only drafts match the current filter.
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section className="sidebar-section browser-current-strip">
        <div className="eyebrow">Current endpoint</div>
        <div className="browser-current-summary">
          <div>
            <p className="endpoint-name" style={{ marginTop: 8 }}>{currentEndpoint?.name || sessionId}</p>
            <p className="endpoint-id">{sessionId}</p>
          </div>
          <span className={`source-pill ${currentEndpoint?.source === 'server' ? 'saved' : 'local'}`}>
            {getSourceLabel(currentEndpoint)}
          </span>
        </div>
      </section>
    </div>
  )
}
