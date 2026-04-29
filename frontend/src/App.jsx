import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from './components/ConfirmDialog.jsx'
import { EndpointSidebar } from './components/EndpointSidebar.jsx'
import { EventInspector } from './components/EventInspector.jsx'
import { EventList } from './components/EventList.jsx'
import { SetupRail } from './components/SetupRail.jsx'
import { StatusBanner } from './components/StatusBanner.jsx'
import { useEndpointState } from './hooks/useEndpointState.jsx'
import { useEventStream } from './hooks/useEventStream.jsx'
import {
  codeFontStack,
  copyText,
  getErrorMessage,
  readJson,
  uiFontStack,
} from './ui.js'

export default function App() {
  const localOrigin = window.location.origin
  const controlOrigin =
    window.location.port === '5173'
      ? `${window.location.protocol}//${window.location.hostname}`
      : localOrigin
  const controlApiBase = `${controlOrigin}/api`
  const websocketOrigin = new URL(controlOrigin)

  const {
    sessionId,
    serverEndpoints,
    localEndpoints,
    currentEndpoint,
    sessionsLoading,
    sessionsError,
    searchQuery,
    setSearchQuery,
    createFormOpen,
    setCreateFormOpen,
    createName,
    setCreateName,
    createId,
    setCreateId,
    switchEndpoint,
    createEndpoint,
    deleteEndpointLocal,
    syncCurrentSummary,
  } = useEndpointState({ controlApiBase })

  const {
    events,
    selectedEvent,
    selectedEventId,
    setSelectedEventId,
    loadingHistory,
    historyError,
    socketState,
    testState,
    clearState,
    replayState,
    actionError,
    clearActionError,
    sendTestWebhook,
    clearSession,
    replayEvent,
    downloadEvent,
  } = useEventStream({
    sessionId,
    controlApiBase,
    websocketOrigin,
  })

  const [copyState, setCopyState] = useState({
    local: false,
    public: false,
    endpointId: null,
  })
  const [tunnelState, setTunnelState] = useState({
    status: 'loading',
    url: null,
    message: 'Checking for a public ingest URL.',
  })
  const [forwardUrl, setForwardUrl] = useState('')
  const [forwardState, setForwardState] = useState('loading')
  const [forwardError, setForwardError] = useState('')
  const [inspectorTab, setInspectorTab] = useState('body')
  const [confirmState, setConfirmState] = useState(null)
  const [deleteState, setDeleteState] = useState({ id: null, error: '' })

  const localWebhookUrl = `${controlApiBase}/hooks/${sessionId}`
  const publicWebhookUrl = tunnelState.url ? `${tunnelState.url}/api/hooks/${sessionId}` : null

  useEffect(() => {
    syncCurrentSummary(sessionId, events)
  }, [events, sessionId, syncCurrentSummary])

  useEffect(() => {
    setInspectorTab('body')
  }, [selectedEventId])

  useEffect(() => {
    let cancelled = false

    async function fetchTunnel() {
      if (!cancelled) {
        setTunnelState((prev) =>
          prev.status === 'ready'
            ? prev
            : { status: 'loading', url: prev.url, message: 'Checking for a public ingest URL.' },
        )
      }

      try {
        const data = await readJson(await fetch(`${controlApiBase}/tunnel-url`))
        if (cancelled) return
        if (data?.url) {
          setTunnelState({
            status: 'ready',
            url: data.url,
            message: 'Public ingest is live. Give this URL to third-party providers.',
          })
          return
        }

        setTunnelState({
          status: 'unavailable',
          url: null,
          message: 'Public ingest is unavailable until the tunnel reports a URL.',
        })
      } catch (error) {
        if (cancelled) return
        setTunnelState({
          status: 'error',
          url: null,
          message: getErrorMessage(error, 'Unable to load tunnel status.'),
        })
      }
    }

    fetchTunnel()
    const interval = window.setInterval(fetchTunnel, 10000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [controlApiBase])

  useEffect(() => {
    let cancelled = false

    async function loadConfig() {
      setForwardState('loading')
      setForwardError('')
      try {
        const data = await readJson(await fetch(`${controlApiBase}/sessions/${sessionId}/config`))
        if (cancelled) return
        setForwardUrl(data?.forward_url || '')
        setForwardState('idle')
      } catch (error) {
        if (cancelled) return
        setForwardUrl('')
        setForwardState('error')
        setForwardError(getErrorMessage(error, 'Unable to load the forward target for this endpoint.'))
      }
    }

    loadConfig()
    return () => {
      cancelled = true
    }
  }, [controlApiBase, sessionId])

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'
    img.src = '/logo.png'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width || 32
      canvas.height = img.height || 32
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.filter = 'brightness(0) invert(1)'
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      try {
        const dataURL = canvas.toDataURL('image/png')
        let link = document.querySelector("link[rel~='icon']")
        if (!link) {
          link = document.createElement('link')
          link.rel = 'icon'
          document.head.appendChild(link)
        }
        link.href = dataURL
      } catch (error) {
        console.error('Could not update favicon:', error)
      }
    }
  }, [])

  async function handleCopy(kind, value, endpointId = null) {
    if (!value) return
    const copied = await copyText(value)
    if (!copied) return

    if (kind === 'endpointId') {
      setCopyState((prev) => ({ ...prev, endpointId }))
      window.setTimeout(() => {
        setCopyState((prev) => (prev.endpointId === endpointId ? { ...prev, endpointId: null } : prev))
      }, 1800)
      return
    }

    setCopyState((prev) => ({ ...prev, [kind]: true }))
    window.setTimeout(() => {
      setCopyState((prev) => ({ ...prev, [kind]: false }))
    }, 1800)
  }

  async function handleSaveForwardUrl() {
    setForwardState('saving')
    setForwardError('')
    try {
      const response = await fetch(`${controlApiBase}/sessions/${sessionId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forward_url: forwardUrl || null }),
      })

      const data = await readJson(response)
      setForwardUrl(data?.forward_url || '')
      setForwardState('saved')
      window.setTimeout(() => {
        setForwardState((prev) => (prev === 'saved' ? 'idle' : prev))
      }, 1600)
    } catch (error) {
      setForwardState('error')
      setForwardError(getErrorMessage(error, 'Saving the forward target failed.'))
    }
  }

  function handleCreateEndpoint() {
    createEndpoint()
    setCreateFormOpen(false)
  }

  function handleForgetLocal(endpointId) {
    deleteEndpointLocal(endpointId)
  }

  async function handleConfirmDelete() {
    if (!confirmState || confirmState.kind !== 'delete-endpoint') return
    const endpointId = confirmState.endpointId
    setDeleteState({ id: endpointId, error: '' })

    try {
      const response = await fetch(`${controlApiBase}/sessions/${endpointId}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(`Delete failed with status ${response.status}.`)
      }

      deleteEndpointLocal(endpointId)
      if (endpointId === sessionId) {
        createEndpoint('Recovered endpoint')
      }
      setConfirmState(null)
    } catch (error) {
      setDeleteState({
        id: endpointId,
        error: getErrorMessage(error, 'Deleting the endpoint failed.'),
      })
    } finally {
      setDeleteState((prev) => ({ ...prev, id: null }))
    }
  }

  async function handleConfirmClear() {
    try {
      await clearSession()
      setConfirmState(null)
    } catch {
      // useEventStream already exposes the error
    }
  }

  const banners = useMemo(() => {
    const items = []

    if (tunnelState.status === 'unavailable') {
      items.push({ tone: 'warning', message: tunnelState.message })
    }
    if (tunnelState.status === 'error') {
      items.push({ tone: 'error', message: tunnelState.message })
    }
    if (socketState !== 'connected') {
      items.push({
        tone: socketState === 'connecting' ? 'info' : 'warning',
        message:
          socketState === 'connecting'
            ? 'Connecting to the live event stream.'
            : 'Live event stream disconnected. HookRelay is retrying automatically.',
      })
    }
    if (sessionsError) {
      items.push({ tone: 'error', message: sessionsError })
    }
    if (historyError) {
      items.push({ tone: 'error', message: historyError })
    }
    if (forwardError && forwardState === 'error') {
      items.push({ tone: 'error', message: forwardError })
    }
    if (deleteState.error) {
      items.push({ tone: 'error', message: deleteState.error })
    }
    if (actionError) {
      items.push({ tone: 'error', message: actionError })
    }

    return items
  }, [actionError, deleteState.error, forwardError, forwardState, historyError, sessionsError, socketState, tunnelState])

  return (
    <>
      <style>{`
        :root {
          color-scheme: dark;
          --bg: #09090b;
          --panel: #111217;
          --panel-2: #171922;
          --panel-3: #1e2230;
          --line: rgba(255,255,255,0.08);
          --line-strong: rgba(255,255,255,0.14);
          --text: #f4f4f5;
          --muted: #a1a1aa;
          --dim: #71717a;
          --accent: #7c8cff;
          --accent-soft: rgba(124,140,255,0.14);
          --success: #34d399;
          --warning: #fbbf24;
          --danger: #fb7185;
          --shadow: 0 18px 45px rgba(0,0,0,0.35);
        }
        * { box-sizing: border-box; }
        html, body, #root { height: 100%; }
        body {
          margin: 0;
          background:
            radial-gradient(circle at top left, rgba(124,140,255,0.16), transparent 28%),
            radial-gradient(circle at bottom right, rgba(56,189,248,0.10), transparent 24%),
            var(--bg);
          color: var(--text);
          font-family: ${uiFontStack};
          -webkit-font-smoothing: antialiased;
        }
        button, input, textarea {
          font: inherit;
        }
        button {
          border: 0;
          background: none;
          color: inherit;
        }
        button:focus-visible,
        input:focus-visible,
        textarea:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.12);
          border-radius: 999px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .app-shell {
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr);
          min-height: 100%;
        }
        .sidebar {
          border-right: 1px solid var(--line);
          background: rgba(11, 12, 17, 0.86);
          backdrop-filter: blur(18px);
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }
        .main-shell {
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr);
          min-height: 100vh;
        }
        .brand-row,
        .sidebar-section,
        .setup-wrap,
        .content-wrap {
          padding-left: 24px;
          padding-right: 24px;
        }
        .brand-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 22px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--line);
        }
        .brand-block {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .brand-mark {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          background: linear-gradient(160deg, rgba(124,140,255,0.22), rgba(124,140,255,0.02));
          border: 1px solid rgba(124,140,255,0.24);
          display: grid;
          place-items: center;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .brand-mark img {
          width: 18px;
          height: 18px;
          filter: brightness(0) invert(1);
        }
        .eyebrow {
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--dim);
        }
        .title {
          margin: 0;
          font-size: 17px;
          font-weight: 700;
          letter-spacing: -0.03em;
        }
        .subtle-copy {
          margin: 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.5;
        }
        .sidebar-section {
          padding-top: 18px;
          padding-bottom: 18px;
        }
        .sidebar-section + .sidebar-section {
          border-top: 1px solid rgba(255,255,255,0.04);
        }
        .primary-button,
        .secondary-button,
        .danger-button,
        .ghost-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 12px;
          padding: 11px 14px;
          cursor: pointer;
          transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
          white-space: nowrap;
        }
        .primary-button:hover,
        .secondary-button:hover,
        .danger-button:hover,
        .ghost-button:hover {
          transform: translateY(-1px);
        }
        .primary-button {
          color: white;
          background: linear-gradient(180deg, #8b98ff, #6e7df7);
          box-shadow: 0 14px 28px rgba(91, 104, 255, 0.28);
        }
        .secondary-button {
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--line);
          color: var(--text);
        }
        .ghost-button {
          background: transparent;
          border: 1px solid var(--line);
          color: var(--muted);
        }
        .danger-button {
          background: rgba(251,113,133,0.10);
          border: 1px solid rgba(251,113,133,0.26);
          color: #fecdd3;
        }
        .primary-button[disabled],
        .secondary-button[disabled],
        .ghost-button[disabled],
        .danger-button[disabled] {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none;
        }
        .search-input,
        .text-input {
          width: 100%;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.03);
          color: var(--text);
          padding: 12px 14px;
        }
        .search-input::placeholder,
        .text-input::placeholder {
          color: var(--dim);
        }
        .helper-note {
          font-size: 12px;
          color: var(--dim);
          line-height: 1.45;
        }
        .endpoint-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 16px;
          min-height: 0;
          overflow: auto;
          padding-right: 4px;
        }
        .endpoint-card {
          border: 1px solid var(--line);
          border-radius: 16px;
          background: rgba(255,255,255,0.03);
          padding: 14px;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
        }
        .endpoint-card:hover {
          transform: translateY(-1px);
          border-color: var(--line-strong);
          background: rgba(255,255,255,0.05);
        }
        .endpoint-card.active {
          background: linear-gradient(180deg, rgba(124,140,255,0.16), rgba(124,140,255,0.05));
          border-color: rgba(124,140,255,0.34);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
        }
        .endpoint-header,
        .row-between,
        .inline-actions {
          display: flex;
          align-items: center;
        }
        .row-between {
          justify-content: space-between;
          gap: 12px;
        }
        .endpoint-header {
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .inline-actions {
          gap: 8px;
          flex-wrap: wrap;
        }
        .endpoint-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
          margin: 0 0 4px;
        }
        .endpoint-id,
        .code-chip,
        .mono-text {
          font-family: ${codeFontStack};
        }
        .endpoint-id {
          font-size: 11px;
          color: var(--dim);
          margin: 0;
        }
        .meta-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 12px;
        }
        .meta-pill {
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 12px;
          background: rgba(0,0,0,0.20);
          padding: 10px 12px;
        }
        .meta-label {
          display: block;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--dim);
          margin-bottom: 4px;
        }
        .meta-value {
          font-size: 12px;
          color: var(--text);
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #52525b;
          flex: 0 0 auto;
        }
        .dot.live {
          background: var(--success);
          box-shadow: 0 0 0 6px rgba(52,211,153,0.14);
        }
        .sidebar-form {
          margin-top: 14px;
          padding: 14px;
          border: 1px solid var(--line);
          border-radius: 16px;
          background: rgba(255,255,255,0.03);
          display: grid;
          gap: 10px;
        }
        .page-top {
          padding-top: 18px;
          padding-bottom: 16px;
          border-bottom: 1px solid var(--line);
          background: rgba(13,14,20,0.78);
          backdrop-filter: blur(14px);
        }
        .setup-wrap {
          padding-top: 20px;
          padding-bottom: 20px;
        }
        .setup-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }
        .setup-card,
        .surface-card {
          border: 1px solid var(--line);
          border-radius: 20px;
          background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
          box-shadow: var(--shadow);
        }
        .setup-card {
          padding: 18px;
        }
        .step-badge {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          background: var(--accent-soft);
          color: #c8d0ff;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          padding: 6px 9px;
          margin-bottom: 12px;
        }
        .setup-title {
          margin: 0 0 8px;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -0.02em;
        }
        .setup-value {
          margin-top: 14px;
          padding: 14px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.06);
          background: rgba(8,8,12,0.46);
        }
        .setup-value strong {
          display: block;
          font-size: 11px;
          color: var(--dim);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 8px;
        }
        .setup-url {
          display: block;
          color: var(--text);
          line-height: 1.5;
          word-break: break-word;
        }
        .setup-url.secondary {
          color: var(--muted);
        }
        .copy-row {
          display: flex;
          gap: 10px;
          margin-top: 14px;
          flex-wrap: wrap;
        }
        .status-line {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 14px;
          font-size: 12px;
          color: var(--muted);
        }
        .status-chip {
          display: inline-flex;
          align-items: center;
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          background: rgba(255,255,255,0.06);
          color: var(--text);
        }
        .status-chip.ready { background: rgba(52,211,153,0.12); color: #a7f3d0; }
        .status-chip.warning { background: rgba(251,191,36,0.12); color: #fde68a; }
        .status-chip.error { background: rgba(251,113,133,0.14); color: #fecdd3; }
        .status-chip.info { background: rgba(96,165,250,0.12); color: #bfdbfe; }
        .source-pill {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        .source-pill.saved {
          background: rgba(52,211,153,0.12);
          color: #a7f3d0;
        }
        .source-pill.local {
          background: rgba(251,191,36,0.12);
          color: #fde68a;
        }
        .content-wrap {
          padding-top: 20px;
          padding-bottom: 24px;
          min-height: 0;
        }
        .content-grid {
          display: grid;
          grid-template-columns: minmax(340px, 420px) minmax(0, 1fr);
          gap: 18px;
          min-height: 0;
          height: 100%;
        }
        .surface-card {
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .surface-header {
          padding: 18px 18px 14px;
          border-bottom: 1px solid var(--line);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .surface-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }
        .surface-body {
          padding: 18px;
          min-height: 0;
          overflow: auto;
        }
        .event-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .event-row {
          width: 100%;
          text-align: left;
          padding: 14px;
          border-radius: 16px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.03);
          cursor: pointer;
          transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
        }
        .event-row:hover {
          transform: translateY(-1px);
          border-color: var(--line-strong);
        }
        .event-row.active {
          border-color: rgba(124,140,255,0.34);
          background: rgba(124,140,255,0.10);
        }
        .pill-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 700;
          background: rgba(255,255,255,0.06);
          color: var(--text);
        }
        .pill.method {
          background: rgba(124,140,255,0.16);
          color: #c7d2fe;
        }
        .pill.replay {
          background: rgba(192,132,252,0.14);
          color: #e9d5ff;
        }
        .pill.success {
          background: rgba(52,211,153,0.12);
          color: #a7f3d0;
        }
        .pill.warning {
          background: rgba(251,191,36,0.12);
          color: #fde68a;
        }
        .pill.error {
          background: rgba(251,113,133,0.14);
          color: #fecdd3;
        }
        .inspector-tabs {
          display: flex;
          gap: 8px;
          padding: 0 18px 16px;
          border-bottom: 1px solid var(--line);
        }
        .tab-button {
          border-radius: 999px;
          padding: 9px 12px;
          border: 1px solid var(--line);
          cursor: pointer;
          color: var(--muted);
        }
        .tab-button.active {
          background: var(--accent-soft);
          border-color: rgba(124,140,255,0.28);
          color: #dbe4ff;
        }
        .empty-state {
          border: 1px dashed rgba(255,255,255,0.12);
          border-radius: 18px;
          padding: 22px;
          background: rgba(255,255,255,0.02);
        }
        .empty-state h3 {
          margin: 0 0 8px;
          font-size: 16px;
        }
        .empty-state ol {
          margin: 14px 0 0;
          padding-left: 18px;
          color: var(--muted);
          line-height: 1.7;
        }
        .code-block {
          margin: 0;
          padding: 16px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.06);
          background: rgba(6,7,10,0.70);
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          font-family: ${codeFontStack};
          font-size: 12px;
          line-height: 1.65;
          color: #e4e4e7;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .status-banner-stack {
          padding: 14px 24px 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .status-banner {
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid var(--line);
          font-size: 13px;
          line-height: 1.5;
        }
        .status-banner.info {
          background: rgba(96,165,250,0.10);
          border-color: rgba(96,165,250,0.20);
          color: #dbeafe;
        }
        .status-banner.warning {
          background: rgba(251,191,36,0.10);
          border-color: rgba(251,191,36,0.20);
          color: #fef3c7;
        }
        .status-banner.error {
          background: rgba(251,113,133,0.10);
          border-color: rgba(251,113,133,0.22);
          color: #ffe4e6;
        }
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(4,4,8,0.72);
          display: grid;
          place-items: center;
          padding: 24px;
          z-index: 200;
          backdrop-filter: blur(10px);
        }
        .modal-card {
          width: min(480px, 100%);
          border-radius: 22px;
          border: 1px solid var(--line);
          background: #111217;
          box-shadow: var(--shadow);
          overflow: hidden;
        }
        .modal-section {
          padding: 20px 22px;
        }
        .modal-section + .modal-section {
          border-top: 1px solid var(--line);
        }
        @media (max-width: 1180px) {
          .setup-grid,
          .content-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 960px) {
          .app-shell {
            grid-template-columns: 1fr;
          }
          .sidebar {
            min-height: auto;
            border-right: 0;
            border-bottom: 1px solid var(--line);
          }
          .main-shell {
            min-height: auto;
          }
        }
      `}</style>

      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-row">
            <div className="brand-block">
              <div className="brand-mark">
                <img src="/logo.png" alt="HookRelay" />
              </div>
              <div>
                <div className="eyebrow">Local control plane</div>
                <h1 className="title">HookRelay</h1>
              </div>
            </div>
          </div>

          <EndpointSidebar
            serverEndpoints={serverEndpoints}
            localEndpoints={localEndpoints}
            sessionId={sessionId}
            currentEndpoint={currentEndpoint}
            sessionsLoading={sessionsLoading}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            createFormOpen={createFormOpen}
            setCreateFormOpen={setCreateFormOpen}
            createName={createName}
            setCreateName={setCreateName}
            createId={createId}
            setCreateId={setCreateId}
            onCreateEndpoint={handleCreateEndpoint}
            onSelectEndpoint={switchEndpoint}
            onRequestDelete={(endpointId) => setConfirmState({ kind: 'delete-endpoint', endpointId })}
            onForgetLocal={handleForgetLocal}
            onCopyEndpointId={(endpointId) => handleCopy('endpointId', endpointId, endpointId)}
            copiedEndpointId={copyState.endpointId}
            connected={socketState === 'connected'}
          />
        </aside>

        <main className="main-shell">
          <div className="page-top">
            <SetupRail
              endpointName={currentEndpoint?.name || sessionId}
              endpointId={sessionId}
              localWebhookUrl={localWebhookUrl}
              publicWebhookUrl={publicWebhookUrl}
              tunnelState={tunnelState}
              forwardUrl={forwardUrl}
              forwardState={forwardState}
              onForwardUrlChange={setForwardUrl}
              onSaveForwardUrl={handleSaveForwardUrl}
              onTriggerTest={sendTestWebhook}
              testState={testState}
              copiedLocal={copyState.local}
              copiedPublic={copyState.public}
              onCopyLocal={() => handleCopy('local', localWebhookUrl)}
              onCopyPublic={() => handleCopy('public', publicWebhookUrl)}
            />
          </div>

          <StatusBanner banners={banners} onDismissError={clearActionError} />

          <div className="content-wrap">
            <div className="content-grid">
              <EventList
                events={events}
                selectedEventId={selectedEventId}
                onSelectEvent={setSelectedEventId}
                loadingHistory={loadingHistory}
                clearState={clearState}
                onRequestClear={() => setConfirmState({ kind: 'clear-feed' })}
                endpointName={currentEndpoint?.name || sessionId}
                endpointSource={currentEndpoint?.source || 'current_unsaved'}
                tunnelReady={tunnelState.status === 'ready'}
              />

              <EventInspector
                event={selectedEvent}
                activeTab={inspectorTab}
                onChangeTab={setInspectorTab}
                onReplayEvent={replayEvent}
                onDownloadEvent={downloadEvent}
                replayState={replayState}
              />
            </div>
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={
          confirmState?.kind === 'delete-endpoint'
            ? 'Delete this endpoint?'
            : 'Clear this event feed?'
        }
        description={
          confirmState?.kind === 'delete-endpoint'
            ? 'This removes the saved endpoint and deletes its stored events. Names are only local, but the event history is real.'
            : 'This deletes the stored events for the current endpoint. This cannot be undone.'
        }
        confirmLabel={
          confirmState?.kind === 'delete-endpoint'
            ? deleteState.id ? 'Deleting…' : 'Delete endpoint'
            : clearState === 'loading' ? 'Clearing…' : 'Clear feed'
        }
        confirmTone={confirmState?.kind === 'delete-endpoint' ? 'danger' : 'secondary'}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.kind === 'delete-endpoint' ? handleConfirmDelete : handleConfirmClear}
        disabled={Boolean(deleteState.id) || clearState === 'loading'}
      />
    </>
  )
}
