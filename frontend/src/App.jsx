import { useState, useEffect, useRef } from 'react'

function generateSessionId() {
  return Math.random().toString(36).slice(2, 10)
}

function getSessionFromUrl() {
  const hash = window.location.hash.replace('#', '')
  return hash || null
}

export default function App() {
  const [sessionId, setSessionId] = useState(() => {
    const fromUrl = getSessionFromUrl()
    if (fromUrl) return fromUrl
    const newId = generateSessionId()
    window.location.hash = newId
    return newId
  })

  const [events, setEvents]         = useState([])
  const [connected, setConnected]   = useState(false)
  const [copied, setCopied]         = useState(false)
  const [sessions, setSessions]     = useState([])
  const [inputValue, setInputValue] = useState('')
  const [forwardUrl, setForwardUrl] = useState('')
  const [forwardSaved, setForwardSaved] = useState(false)
  const [tunnelUrl, setTunnelUrl]   = useState(null)
  const [replayingId, setReplayingId] = useState(null)
  const wsRef = useRef(null)

  const webhookUrl = `${window.location.protocol}//${window.location.host}/api/hooks/${sessionId}`
  const tunnelWebhookUrl = tunnelUrl ? `${tunnelUrl}/api/hooks/${sessionId}` : null

  // ── Switch session ────────────────────────────────────────────────────────
  function switchSession(id) {
    const clean = id.trim()
    if (!clean) return
    window.location.hash = clean
    setEvents([])
    setForwardUrl('')
    setForwardSaved(false)
    setSessionId(clean)
  }

  function handleInputKeyDown(e) {
    if (e.key === 'Enter') {
      switchSession(inputValue)
      setInputValue('')
    }
  }

  // ── Load history on session change ────────────────────────────────────────
  useEffect(() => {
    setEvents([])
    fetch(`/api/hooks/${sessionId}`)
      .then(r => r.json())
      .then(data => setEvents(data))
      .catch(() => {})
  }, [sessionId])

  // ── Load session config on session change ─────────────────────────────────
  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/config`)
      .then(r => r.json())
      .then(data => {
        setForwardUrl(data.forward_url || '')
        setForwardSaved(!!data.forward_url)
      })
      .catch(() => {})
  }, [sessionId])

  // ── WebSocket — closes old, opens new when session changes ────────────────
  useEffect(() => {
    let cancelled = false

    function connect() {
      if (cancelled) return
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/${sessionId}`)
      ws.onopen    = () => { if (!cancelled) setConnected(true) }
      ws.onclose   = () => { if (!cancelled) { setConnected(false); setTimeout(connect, 2000) } }
      ws.onerror   = () => ws.close()
      ws.onmessage = (e) => {
        if (cancelled) return
        const newEvent = JSON.parse(e.data)
        setEvents(prev => {
          // If this is an update to an existing event (forwarding result), replace it
          const idx = prev.findIndex(ev => ev.id === newEvent.id)
          if (idx !== -1) {
            const updated = [...prev]
            updated[idx] = newEvent
            return updated
          }
          return [newEvent, ...prev]
        })
      }
      wsRef.current = ws
    }

    connect()
    return () => {
      cancelled = true
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [sessionId])

  // ── Poll sessions list every 5 s ──────────────────────────────────────────
  useEffect(() => {
    function fetchSessions() {
      fetch('/api/sessions')
        .then(r => r.json())
        .then(data => setSessions(data))
        .catch(() => {})
    }
    fetchSessions()
    const interval = setInterval(fetchSessions, 5000)
    return () => clearInterval(interval)
  }, [])

  // ── Fetch tunnel URL on mount ─────────────────────────────────────────────
  useEffect(() => {
    function fetchTunnel() {
      fetch('/api/tunnel-url')
        .then(r => r.json())
        .then(data => setTunnelUrl(data.url || null))
        .catch(() => {})
    }
    fetchTunnel()
    const interval = setInterval(fetchTunnel, 10000)
    return () => clearInterval(interval)
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────
  function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function saveForwardUrl() {
    await fetch(`/api/sessions/${sessionId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forward_url: forwardUrl || null }),
    })
    setForwardSaved(true)
    setTimeout(() => setForwardSaved(false), 2000)
  }

  function handleForwardKeyDown(e) {
    if (e.key === 'Enter') saveForwardUrl()
  }

  async function sendTestWebhook() {
    await fetch(`/api/hooks/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'payment.captured',
        order_id: 'order_' + Math.random().toString(36).slice(2, 10),
        amount: Math.floor(Math.random() * 9000) + 1000,
        currency: 'INR',
      }),
    })
  }

  async function clearSession() {
    await fetch(`/api/hooks/${sessionId}`, { method: 'DELETE' })
    setEvents([])
  }

  async function replayEvent(ev) {
    setReplayingId(ev.id)
    try {
      await fetch(`/api/hooks/${sessionId}/${ev.id}/replay`, { method: 'POST' })
    } catch {}
    setTimeout(() => setReplayingId(null), 1000)
  }

  function downloadEvent(ev) {
    const text = ev.body || ''
    let filename = `${ev.session_id}-${ev.id}`
    try {
      JSON.parse(text)
      filename += '.json'
    } catch {
      filename += '.txt'
    }
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function parseBody(raw) {
    try { return JSON.stringify(JSON.parse(raw), null, 2) }
    catch { return raw }
  }

  function getForwardBadge(ev) {
    if (ev.forward_error) return { color: '#fca5a5', bg: '#450a0a', text: `→ Error: ${ev.forward_error.slice(0, 40)}` }
    if (ev.forward_status == null) return null
    if (ev.forward_status >= 200 && ev.forward_status < 300) return { color: '#86efac', bg: '#14532d', text: `→ ${ev.forward_status} OK` }
    if (ev.forward_status >= 400 && ev.forward_status < 500) return { color: '#fbbf24', bg: '#422006', text: `→ ${ev.forward_status} Client Error` }
    return { color: '#fca5a5', bg: '#450a0a', text: `→ ${ev.forward_status} Server Error` }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const btnStyle = (bg) => ({
    background: bg, color: 'white', border: 'none',
    padding: '6px 12px', borderRadius: 5, cursor: 'pointer',
    fontSize: 11, fontFamily: 'monospace', whiteSpace: 'nowrap',
  })

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.75); }
        }
        * { box-sizing: border-box; }
        body { margin: 0; background: #0f0f1a; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2d2d3d; border-radius: 3px; }
        input::placeholder { color: #374151; }
        input:focus { border-color: #3b4fd8 !important; }
        button:hover { opacity: 0.85; }
        button:active { transform: scale(0.97); }
      `}</style>

      <div style={{ display: 'flex', height: '100vh', fontFamily: 'monospace', overflow: 'hidden' }}>

        {/* ── Sidebar ──────────────────────────────────────────────────────── */}
        <div style={{
          width: 240, flexShrink: 0,
          background: '#161622',
          borderRight: '1px solid #2d2d3d',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>

          {/* Brand + input */}
          <div style={{ padding: '20px 14px 14px', borderBottom: '1px solid #2d2d3d' }}>
            <div style={{ marginBottom: 14 }}>
              <img src="/logo.png" alt="HookRelay" style={{ height: 22, display: 'block' }} />
            </div>
            <input
              type="text"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Session name… ↵"
              style={{
                width: '100%',
                background: '#0f0f1a',
                border: '1px solid #2d2d3d',
                borderRadius: 6,
                color: '#e2e8f0',
                fontSize: 12,
                padding: '7px 10px',
                outline: 'none',
                fontFamily: 'monospace',
                transition: 'border-color 0.15s',
              }}
            />
          </div>

          {/* Sessions label */}
          <div style={{
            padding: '10px 14px 6px',
            color: '#374151',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Sessions
          </div>

          {/* Sessions list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 12px' }}>
            {sessions.length === 0 ? (
              <div style={{ color: '#374151', fontSize: 11, padding: '12px 8px', textAlign: 'center' }}>
                No sessions yet
              </div>
            ) : sessions.map(s => {
              const active = s === sessionId
              return (
                <div
                  key={s}
                  onClick={() => switchSession(s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 6, marginBottom: 2,
                    cursor: 'pointer',
                    background: active ? '#1e1e2e' : 'transparent',
                    border: `1px solid ${active ? '#2d2d3d' : 'transparent'}`,
                    color: active ? '#e2e8f0' : '#4b5563',
                    fontSize: 12,
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: active ? '#7dd3fc' : '#1f2937',
                    animation: active ? 'pulse 2s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {s}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>

          {/* Session label */}
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 0, marginBottom: 14 }}>
            Session: <strong style={{ color: '#94a3b8' }}>{sessionId}</strong>
          </p>

          {/* Connection badge */}
          <div style={{
            display: 'inline-block', padding: '6px 14px',
            borderRadius: 6, fontSize: 12, marginBottom: 18,
            background: connected ? '#14532d' : '#450a0a',
            color: connected ? '#86efac' : '#fca5a5',
          }}>
            {connected ? '● Connected — waiting for webhooks' : '● Disconnected — reconnecting...'}
          </div>

          {/* Tunnel URL banner */}
          {tunnelUrl && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: '#172554', border: '1px solid #1e3a8a',
              borderRadius: 8, padding: '9px 14px', marginBottom: 12,
            }}>
              <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 'bold' }}>🌐 PUBLIC</span>
              <span style={{ color: '#93c5fd', fontSize: 12, flex: 1, wordBreak: 'break-all' }}>
                {tunnelWebhookUrl}
              </span>
              <button onClick={() => copyText(tunnelWebhookUrl)} style={btnStyle('#1d4ed8')}>
                Copy
              </button>
            </div>
          )}

          {/* Webhook URL row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#1e1e2e', border: '1px solid #2d2d3d',
            borderRadius: 8, padding: '9px 14px', marginBottom: 12,
          }}>
            <span style={{ color: '#64748b', fontSize: 11, fontWeight: 'bold' }}>LOCAL</span>
            <span style={{ color: '#94a3b8', fontSize: 12, flex: 1, wordBreak: 'break-all' }}>
              {webhookUrl}
            </span>
            <button onClick={() => copyText(webhookUrl)} style={btnStyle(copied ? '#14532d' : '#374151')}>
              {copied ? '✓' : 'Copy'}
            </button>
          </div>

          {/* Forwarding URL input */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#1e1e2e', border: '1px solid #2d2d3d',
            borderRadius: 8, padding: '9px 14px', marginBottom: 18,
          }}>
            <span style={{ color: '#64748b', fontSize: 11, fontWeight: 'bold', flexShrink: 0 }}>FWD →</span>
            <input
              type="text"
              value={forwardUrl}
              onChange={e => { setForwardUrl(e.target.value); setForwardSaved(false) }}
              onKeyDown={handleForwardKeyDown}
              placeholder="http://host.docker.internal:3000/api/webhooks/razorpay"
              style={{
                flex: 1, background: 'transparent', border: 'none',
                color: '#e2e8f0', fontSize: 12, outline: 'none',
                fontFamily: 'monospace',
              }}
            />
            <button onClick={saveForwardUrl} style={btnStyle(forwardSaved ? '#14532d' : '#1d4ed8')}>
              {forwardSaved ? '✓ Saved' : 'Save'}
            </button>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
            <button onClick={sendTestWebhook} style={btnStyle('#1d4ed8')}>
              Send test webhook
            </button>
            <button onClick={clearSession} style={btnStyle('#7f1d1d')}>
              Clear session
            </button>
          </div>

          {/* Events list */}
          {events.length === 0 ? (
            <div style={{
              color: '#4b5563', textAlign: 'center', padding: 48,
              border: '1px dashed #2d2d3d', borderRadius: 8, fontSize: 13,
            }}>
              No webhooks yet — copy the URL above and paste it into any service
            </div>
          ) : events.map(ev => {
            const badge = getForwardBadge(ev)
            const isReplaying = replayingId === ev.id
            return (
              <div key={ev.id} style={{
                background: '#1e1e2e', border: '1px solid #2d2d3d',
                borderRadius: 8, padding: '14px 16px', marginBottom: 12,
              }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, marginBottom: 6, gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    color: ev.method === 'REPLAY' ? '#c084fc' : '#86efac',
                    fontWeight: 'bold',
                  }}>
                    {ev.method}
                  </span>
                  <span style={{ color: '#7dd3fc' }}>/hooks/{ev.session_id}</span>

                  {/* Forward status badge */}
                  {badge && (
                    <span style={{
                      background: badge.bg, color: badge.color,
                      padding: '2px 8px', borderRadius: 4, fontSize: 10,
                    }}>
                      {badge.text}
                    </span>
                  )}

                  <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11, flexShrink: 0 }}>
                    {new Date(ev.received_at).toLocaleTimeString()}
                  </span>
                </div>

                {/* Body */}
                <pre style={{ color: '#fbbf24', fontSize: 12, whiteSpace: 'pre-wrap', margin: '0 0 8px 0' }}>
                  {ev.body ? parseBody(ev.body) : 'no body'}
                </pre>

                {/* Forward response (if present) */}
                {ev.forward_response && (
                  <details style={{ marginBottom: 8 }}>
                    <summary style={{ color: '#64748b', fontSize: 11, cursor: 'pointer' }}>
                      Response from your app
                    </summary>
                    <pre style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'pre-wrap', margin: '6px 0 0', padding: '8px', background: '#0f0f1a', borderRadius: 4 }}>
                      {ev.forward_response}
                    </pre>
                  </details>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => replayEvent(ev)} style={btnStyle(isReplaying ? '#14532d' : '#374151')}>
                    {isReplaying ? '✓ Replayed' : '↻ Replay'}
                  </button>
                  <button onClick={() => downloadEvent(ev)} style={btnStyle('#374151')}>
                    ↓ JSON
                  </button>
                </div>
              </div>
            )
          })}
        </div>

      </div>
    </>
  )
}