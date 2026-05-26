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
  razorpayFixtureOptions,
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

  const [provider, setProvider] = useState('razorpay')
  const [razorpaySecret, setRazorpaySecret] = useState('')
  const [razorpaySecretConfigured, setRazorpaySecretConfigured] = useState(false)
  const [selectedFixtureKey, setSelectedFixtureKey] = useState('payment_captured')

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
    provider,
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
        setProvider(data?.provider === 'generic' && data?.forward_url ? 'generic' : 'razorpay')
        setRazorpaySecret('')
        setRazorpaySecretConfigured(Boolean(data?.razorpay_webhook_secret_configured))
        setForwardState('idle')
      } catch (error) {
        if (cancelled) return
        setForwardUrl('')
        setProvider('razorpay')
        setRazorpaySecret('')
        setRazorpaySecretConfigured(false)
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
      const payload = {
        forward_url: forwardUrl || null,
        provider,
      }
      if (provider !== 'razorpay') {
        payload.razorpay_webhook_secret = ''
      } else if (razorpaySecret.trim()) {
        payload.razorpay_webhook_secret = razorpaySecret
      }

      const response = await fetch(`${controlApiBase}/sessions/${sessionId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await readJson(response)
      setForwardUrl(data?.forward_url || '')
      setProvider(data?.provider === 'razorpay' ? 'razorpay' : 'generic')
      setRazorpaySecret('')
      setRazorpaySecretConfigured(Boolean(data?.razorpay_webhook_secret_configured))
      setForwardState('saved')
      window.setTimeout(() => {
        setForwardState((prev) => (prev === 'saved' ? 'idle' : prev))
      }, 1600)
    } catch (error) {
      setForwardState('error')
      setForwardError(getErrorMessage(error, 'Saving the forward target failed.'))
    }
  }

  async function handleClearRazorpaySecret() {
    setForwardState('saving')
    setForwardError('')
    try {
      const response = await fetch(`${controlApiBase}/sessions/${sessionId}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forward_url: forwardUrl || null,
          provider,
          razorpay_webhook_secret: '',
        }),
      })

      const data = await readJson(response)
      setForwardUrl(data?.forward_url || '')
      setProvider(data?.provider === 'razorpay' ? 'razorpay' : 'generic')
      setRazorpaySecret('')
      setRazorpaySecretConfigured(Boolean(data?.razorpay_webhook_secret_configured))
      setForwardState('saved')
      window.setTimeout(() => {
        setForwardState((prev) => (prev === 'saved' ? 'idle' : prev))
      }, 1600)
    } catch (error) {
      setForwardState('error')
      setForwardError(getErrorMessage(error, 'Clearing the Razorpay secret failed.'))
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
          --bg: #080a0d;
          --panel: #0c0f14;
          --panel-2: #11151c;
          --panel-3: #151922;
          --line: #242a34;
          --line-strong: #343b48;
          --text: #f4f6fb;
          --muted: #9ba2ae;
          --dim: #858b98;
          --accent: #3d62d9;
          --accent-soft: rgba(61,98,217,0.18);
          --accent-soft-strong: rgba(61,98,217,0.28);
          --success: #34d399;
          --warning: #fbbf24;
          --danger: #fb7185;
          --shadow: none;
          --radius-lg: 8px;
          --radius-md: 6px;
          --space-1: 4px;
          --space-2: 8px;
          --space-3: 12px;
          --space-4: 16px;
          --space-5: 20px;
          --space-6: 24px;
        }
        * { box-sizing: border-box; }
        html, body, #root { height: 100%; }
        body {
          margin: 0;
          background: var(--bg);
          color: var(--text);
          font-family: ${uiFontStack};
          -webkit-font-smoothing: antialiased;
        }
        button, input, textarea, select {
          font: inherit;
        }
        button {
          border: 0;
          background: none;
          color: inherit;
        }
        button:focus-visible,
        input:focus-visible,
        textarea:focus-visible,
        select:focus-visible {
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
          grid-template-columns: 260px minmax(0, 1fr);
          min-height: 100%;
        }
        .sidebar {
          border-right: 1px solid var(--line);
          background: rgba(9, 11, 17, 0.9);
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          overflow: auto;
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
          padding-left: 16px;
          padding-right: 16px;
        }
        .brand-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--line);
        }
        .brand-block {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .brand-mark {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: rgba(61,98,217,0.12);
          border: 1px solid rgba(61,98,217,0.36);
          display: grid;
          place-items: center;
        }
        .brand-mark img {
          width: 14px;
          height: 14px;
          filter: brightness(0) invert(1);
        }
        .eyebrow {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--dim);
        }
        .title {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0;
        }
        .subtle-copy {
          margin: 0;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.5;
        }
        .sidebar-section {
          padding-top: 14px;
          padding-bottom: 14px;
        }
        .sidebar-section + .sidebar-section {
          border-top: 1px solid rgba(255,255,255,0.04);
        }
        .session-browser-shell {
          display: flex;
          flex-direction: column;
          min-height: 0;
          flex: 1;
        }
        .browser-toolbar {
          display: grid;
          gap: 10px;
        }
        .browser-search-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        .browser-sort {
          width: 100%;
          border-radius: 6px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.03);
          color: var(--text);
          padding: 9px 10px;
        }
        .browser-filter-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .filter-chip {
          border-radius: 999px;
          border: 1px solid var(--line);
          background: transparent;
          color: var(--muted);
          padding: 7px 11px;
          cursor: pointer;
          transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
        }
        .filter-chip.active {
          background: var(--accent-soft);
          border-color: rgba(134,160,255,0.28);
          color: #e1e8ff;
        }
        .browser-table-shell {
          display: flex;
          flex-direction: column;
          min-height: 0;
          gap: 12px;
        }
        .browser-status-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }
        .endpoint-browser {
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: auto;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: transparent;
        }
        .endpoint-browser-group + .endpoint-browser-group {
          border-top: 1px solid rgba(255,255,255,0.05);
        }
        .endpoint-browser-grouphead {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px 8px;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--dim);
        }
        .endpoint-browser-row {
          position: relative;
          width: 100%;
          padding: 12px 14px;
          border-top: 1px solid rgba(255,255,255,0.04);
          background: transparent;
          cursor: pointer;
          text-align: left;
        }
        .endpoint-browser-row:hover {
          background: rgba(255,255,255,0.03);
        }
        .endpoint-browser-row.active {
          background: linear-gradient(180deg, rgba(134,160,255,0.18), rgba(134,160,255,0.08));
        }
        .endpoint-browser-row.active::before {
          content: '';
          position: absolute;
          inset: 10px auto 10px 6px;
          width: 3px;
          border-radius: 999px;
          background: var(--accent);
        }
        .endpoint-browser-rowhead {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }
        .endpoint-browser-titleline {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .endpoint-browser-nameblock {
          min-width: 0;
          flex: 1;
        }
        .endpoint-browser-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 10px;
        }
        .endpoint-browser-fact {
          color: var(--muted);
          font-size: 12px;
          white-space: nowrap;
        }
        .endpoint-browser-actions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          flex: 0 0 auto;
        }
        .row-action-button {
          border: 1px solid var(--line);
          border-radius: 6px;
          background: rgba(255,255,255,0.03);
          color: var(--muted);
          padding: 5px 9px;
          font-size: 11px;
          cursor: pointer;
        }
        .row-action-button.danger {
          color: #fecdd3;
          border-color: rgba(251,113,133,0.22);
          background: rgba(251,113,133,0.1);
        }
        .browser-empty {
          padding: 14px;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.5;
        }
        .browser-current-strip {
          background: rgba(255,255,255,0.02);
        }
        .browser-current-summary {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }
        .current-tag {
          display: inline-flex;
          align-items: center;
          border-radius: 999px;
          padding: 4px 8px;
          background: rgba(255,255,255,0.06);
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .primary-button,
        .secondary-button,
        .danger-button,
        .ghost-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 6px;
          padding: 9px 12px;
          cursor: pointer;
          transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease, opacity 0.15s ease;
          white-space: nowrap;
        }
        .primary-button:hover,
        .secondary-button:hover,
        .danger-button:hover,
        .ghost-button:hover {
          border-color: var(--line-strong);
        }
        .primary-button {
          color: white;
          background: #3d62d9;
          border: 1px solid #496fe8;
          box-shadow: none;
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
          border-radius: 6px;
          border: 1px solid var(--line);
          background: #0d1016;
          color: var(--text);
          padding: 9px 10px;
        }
        .compact-button {
          padding: 7px 10px;
          font-size: 12px;
        }
        .compact-input {
          min-height: 34px;
          padding: 8px 10px;
          font-size: 12px;
        }
        .search-input::placeholder,
        .text-input::placeholder {
          color: var(--dim);
        }
        .text-input option {
          background: var(--panel-2);
          color: var(--text);
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
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
          margin-bottom: 4px;
        }
        .meta-value {
          font-size: 13px;
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
          border-radius: 8px;
          background: rgba(255,255,255,0.03);
          display: grid;
          gap: 10px;
        }
        .page-top {
          padding-top: 10px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--line);
          background: var(--bg);
        }
        .setup-wrap {
          padding-top: 8px;
          padding-bottom: 8px;
        }
        .setup-grid,
        .setup-strip {
          display: grid;
          grid-template-columns: repeat(4, minmax(170px, 1fr));
          gap: 0;
        }
        .setup-hero {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
          margin-bottom: 12px;
        }
        .setup-hero-title {
          font-size: 22px;
          margin-top: 6px;
        }
        .setup-hero-id {
          min-width: 160px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--line);
          background: var(--panel);
          display: grid;
          gap: 4px;
          font-size: 12px;
          color: var(--muted);
        }
        .setup-card,
        .surface-card {
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--panel);
          box-shadow: var(--shadow);
        }
        .setup-card {
          padding: 14px;
        }
        .primary-setup-card {
          background:
            linear-gradient(180deg, rgba(134,160,255,0.08), rgba(255,255,255,0.026));
        }
        .test-setup-card {
          border-color: rgba(134,160,255,0.20);
          background: linear-gradient(180deg, rgba(134,160,255,0.075), rgba(255,255,255,0.024));
        }
        .setup-strip {
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--panel);
          overflow: hidden;
        }
        .setup-step {
          padding: 16px;
          min-width: 0;
          border-right: 1px solid var(--line);
          display: grid;
          align-content: start;
          gap: 10px;
        }
        .setup-step:last-child {
          border-right: 0;
        }
        .step-label {
          font-size: 10px;
          color: var(--dim);
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .setup-primary {
          margin: 0;
          color: var(--text);
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .setup-secondary {
          margin: 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .setup-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
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
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0;
        }
        .setup-value {
          margin-top: 12px;
          padding: 12px 0 0;
          border-top: 1px solid rgba(255,255,255,0.055);
          background: transparent;
        }
        .setup-value.focus {
          border-color: rgba(134,160,255,0.22);
          border-radius: 10px;
          border: 1px solid rgba(134,160,255,0.20);
          background: rgba(7, 11, 22, 0.44);
          padding: 12px;
        }
        .setup-value.compact {
          padding-top: 10px;
        }
        .setup-value.input-card {
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.055);
          background: rgba(7,8,12,0.30);
          padding: 12px;
        }
        .setup-value.fixture-panel {
          border-color: rgba(134,160,255,0.18);
          background: rgba(7, 11, 22, 0.46);
        }
        .setup-stack {
          display: grid;
          gap: 10px;
        }
        .setup-value strong {
          display: block;
          font-size: 12px;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
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
          margin-top: 12px;
          flex-wrap: wrap;
        }
        .fixture-action-row {
          align-items: center;
        }
        .fixture-button {
          min-width: 150px;
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
          padding-top: 10px;
          padding-bottom: 16px;
          min-height: 0;
        }
        .content-grid {
          display: grid;
          grid-template-columns: minmax(420px, 0.9fr) minmax(460px, 1.1fr);
          gap: 12px;
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
          padding: 14px;
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
          padding: 14px;
          min-height: 0;
          overflow: auto;
        }
        .event-table {
          display: flex;
          flex-direction: column;
          min-height: 0;
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 6px;
          overflow: hidden;
          background: rgba(8,10,15,0.5);
        }
        .event-table-body {
          display: flex;
          flex-direction: column;
          gap: 0;
        }
        .event-row {
          width: 100%;
          text-align: left;
          padding: 12px;
          border-radius: 0;
          border: 0;
          border-top: 1px solid rgba(255,255,255,0.05);
          background: transparent;
          cursor: pointer;
          transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
        }
        .event-row:hover {
          background: rgba(255,255,255,0.025);
        }
        .event-row.active {
          background: rgba(61,98,217,0.12);
        }
        .event-row-top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: flex-start;
        }
        .event-row-main {
          min-width: 0;
          display: grid;
          gap: 8px;
        }
        .event-row-title,
        .pill-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          color: var(--text);
          font-size: 13px;
          font-weight: 700;
        }
        .event-row-subtitle {
          font-size: 12px;
          color: var(--muted);
        }
        .event-row-metrics {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .event-metric {
          font-size: 12px;
          color: var(--muted);
          white-space: nowrap;
        }
        .event-row-bottom {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          margin-top: 8px;
        }
        .event-preview {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #d4d4d8;
          font-size: 12px;
        }
        .event-age {
          color: var(--dim);
          font-size: 12px;
          white-space: nowrap;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border-radius: 999px;
          padding: 4px 9px;
          font-size: 10px;
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
          padding: 10px 14px;
          border-bottom: 1px solid var(--line);
          background: transparent;
        }
        .tab-button {
          border-radius: 6px;
          padding: 7px 10px;
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
          border-radius: 6px;
          padding: 16px;
          background: transparent;
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
          padding: 12px;
          border-radius: 6px;
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
          gap: 10px;
        }
        .inspector-card {
          position: relative;
        }
        .inspector-header {
          background: transparent;
        }
        .inspector-actions {
          align-items: center;
        }
        .inspector-body {
          background: transparent;
        }
        .inspector-summary-strip {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .diagnostic-note {
          margin: 0;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid var(--line);
          background: rgba(255,255,255,0.04);
          color: var(--text);
          font-size: 13px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }
        .diagnostic-note.success {
          background: rgba(52,211,153,0.08);
          border-color: rgba(52,211,153,0.18);
          color: #d1fae5;
        }
        .diagnostic-note.warning {
          background: rgba(251,191,36,0.08);
          border-color: rgba(251,191,36,0.18);
          color: #fef3c7;
        }
        .diagnostic-note.error {
          background: rgba(251,113,133,0.10);
          border-color: rgba(251,113,133,0.22);
          color: #ffe4e6;
        }
        .diagnostic-note.info {
          background: rgba(96,165,250,0.08);
          border-color: rgba(96,165,250,0.18);
          color: #dbeafe;
        }
        .inspector-section-stack {
          display: grid;
          gap: 16px;
        }
        .inspector-section {
          display: grid;
          gap: 10px;
        }
        .inspector-section-title {
          margin-bottom: 0;
        }
        .status-banner-stack {
          padding: 10px 16px 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .status-banner {
          padding: 9px 12px;
          border-radius: 6px;
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
          .setup-strip,
          .content-grid {
            grid-template-columns: 1fr;
          }
          .setup-step {
            border-right: 0;
            border-bottom: 1px solid var(--line);
          }
          .setup-step:last-child {
            border-bottom: 0;
          }
          .setup-hero {
            flex-direction: column;
          }
          .setup-hero-id {
            min-width: 0;
            width: 100%;
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
          .browser-search-row {
            grid-template-columns: 1fr;
          }
          .endpoint-browser-rowhead,
          .browser-current-summary {
            flex-direction: column;
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
              provider={provider}
              onProviderChange={setProvider}
              razorpaySecret={razorpaySecret}
              razorpaySecretConfigured={razorpaySecretConfigured}
              onRazorpaySecretChange={setRazorpaySecret}
              onClearRazorpaySecret={handleClearRazorpaySecret}
              forwardUrl={forwardUrl}
              forwardState={forwardState}
              onForwardUrlChange={setForwardUrl}
              onSaveForwardUrl={handleSaveForwardUrl}
              fixtureOptions={razorpayFixtureOptions}
              selectedFixtureKey={selectedFixtureKey}
              onFixtureChange={setSelectedFixtureKey}
              onTriggerTest={() => sendTestWebhook(selectedFixtureKey)}
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
