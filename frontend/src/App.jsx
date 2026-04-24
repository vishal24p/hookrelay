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
  const [copiedLocal, setCopiedLocal] = useState(false)
  const [copiedTunnel, setCopiedTunnel] = useState(false)
  const [sessions, setSessions]     = useState([])
  const [localHistory, setLocalHistory] = useState(() => JSON.parse(localStorage.getItem('hookrelay_history') || '[]'))
  
  // Overlay State
  const [isOverlayOpen, setIsOverlayOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const [forwardUrl, setForwardUrl] = useState('')
  const [forwardSaved, setForwardSaved] = useState(false)
  const [tunnelUrl, setTunnelUrl]   = useState(null)
  const [replayingId, setReplayingId] = useState(null)

  const wsRef = useRef(null)

  const webhookUrl = `${window.location.protocol}//${window.location.host}/api/hooks/${sessionId}`
  const tunnelWebhookUrl = tunnelUrl ? `${tunnelUrl}/api/hooks/${sessionId}` : null

  // ── Session Management ────────────────────────────────────────────────────
  function switchSession(id) {
    const clean = id.trim()
    if (!clean) return
    window.location.hash = clean
    setEvents([])
    setForwardUrl('')
    setForwardSaved(false)
    setSessionId(clean)
    
    // Save to local browser history so empty sessions aren't lost
    setLocalHistory(prev => {
      const next = [clean, ...prev.filter(s => s !== clean)].slice(0, 50)
      localStorage.setItem('hookrelay_history', JSON.stringify(next))
      return next
    })
  }

  function createNewSession() {
    // Open the overlay to let the user type their custom session name
    setSearchQuery('')
    setIsOverlayOpen(true)
    // Small timeout to ensure the input is rendered before we try to focus/manipulate it
    setTimeout(() => {
      const input = document.getElementById('session-search-input')
      if (input) input.focus()
    }, 50)
  }

  // ── Keyboard Shortcut for Overlay ─────────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOverlayOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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
  function copyLocal() {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopiedLocal(true)
      setTimeout(() => setCopiedLocal(false), 2000)
    })
  }

  function copyTunnel() {
    if(!tunnelWebhookUrl) return
    navigator.clipboard.writeText(tunnelWebhookUrl).then(() => {
      setCopiedTunnel(true)
      setTimeout(() => setCopiedTunnel(false), 2000)
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
        currency: 'USD',
        status: 'success'
      }),
    })
  }

  async function clearSession() {
    await fetch(`/api/hooks/${sessionId}`, { method: 'DELETE' })
    setEvents([])
  }

  async function deleteSession(idToDelete) {
    // Optimistically update UI instantly
    setSessions(prev => prev.filter(s => s !== idToDelete))
    setLocalHistory(prev => {
      const next = prev.filter(s => s !== idToDelete)
      localStorage.setItem('hookrelay_history', JSON.stringify(next))
      return next
    })
    
    // Call backend
    await fetch(`/api/sessions/${idToDelete}`, { method: 'DELETE' }).catch(() => {})

    // If deleting the current session, generate a new one
    if (idToDelete === sessionId) {
      setIsOverlayOpen(false)
      const newId = generateSessionId()
      switchSession(newId)
    }
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
    if (ev.forward_error) return { bg: 'rgba(239,68,68,0.1)', text: '#F87171', border: 'rgba(239,68,68,0.2)', label: 'Error' }
    if (ev.forward_status == null) return null
    if (ev.forward_status >= 200 && ev.forward_status < 300) return { bg: 'rgba(16,185,129,0.1)', text: '#34D399', border: 'rgba(16,185,129,0.2)', label: `${ev.forward_status} OK` }
    if (ev.forward_status >= 400 && ev.forward_status < 500) return { bg: 'rgba(245,158,11,0.1)', text: '#FBBF24', border: 'rgba(245,158,11,0.2)', label: `${ev.forward_status} Client Error` }
    return { bg: 'rgba(239,68,68,0.1)', text: '#F87171', border: 'rgba(239,68,68,0.2)', label: `${ev.forward_status} Server Error` }
  }

  // Inject current session and local history into the list if it's not there
  const allSessionsSet = new Set([...localHistory, ...sessions, sessionId])
  const allSessions = Array.from(allSessionsSet)
  const filteredSessions = allSessions.filter(s => s.toLowerCase().includes(searchQuery.toLowerCase()))

  // ── Layout State ──────────────────────────────────────────────────────────
  const [feedLayout, setFeedLayout] = useState(() => localStorage.getItem('hookrelay_feed_layout') || 'list')
  function toggleLayout(type) {
    setFeedLayout(type)
    localStorage.setItem('hookrelay_feed_layout', type)
  }

  // ── Favicon Inversion ─────────────────────────────────────────────────────
  useEffect(() => {
    // Dynamically invert the favicon using canvas so it is visible in dark browser tabs
    const img = new Image()
    img.crossOrigin = "Anonymous"
    img.src = '/logo.png'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width || 32
      canvas.height = img.height || 32
      const ctx = canvas.getContext('2d')
      
      // Apply the same CSS filter used for the UI logo
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
      } catch (e) {
        console.error("Could not update favicon:", e)
      }
    }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  const btnStyle = (primary) => ({
    background: primary ? '#2F2FE4' : 'rgba(255,255,255,0.05)',
    color: primary ? '#FAFAFA' : '#E4E4E7',
    border: primary ? '1px solid #2F2FE4' : '1px solid rgba(255,255,255,0.1)',
    padding: '6px 12px', 
    borderRadius: '6px', 
    cursor: 'pointer',
    fontSize: '12px', 
    fontFamily: '"Geist", system-ui, sans-serif',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    transition: 'all 0.2s ease',
    boxShadow: primary ? '0 4px 12px rgba(47, 47, 228, 0.25)' : 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    outline: 'none'
  })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Fira+Code:wght@400;500&display=swap');
        
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(47, 47, 228, 0.4); }
          50%       { opacity: 0.8; transform: scale(0.95); box-shadow: 0 0 0 6px rgba(47, 47, 228, 0); }
        }
        * { box-sizing: border-box; }
        body { 
          margin: 0; 
          background: #09090B; 
          color: #FAFAFA;
          font-family: 'Geist', system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        
        /* Subtle Custom Scrollbar */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 4px; border: 2px solid #09090B; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
        
        /* Interactive Elements */
        button:hover { filter: brightness(1.15); transform: translateY(-1px); }
        button:active { transform: scale(0.98); }
        
        .code-font { font-family: 'Fira Code', monospace; }
        
        .event-card { transition: all 0.2s ease; }
        .event-card:hover {
          border-color: rgba(255,255,255,0.12) !important;
          transform: translateY(-1px);
          box-shadow: 0 8px 16px -4px rgba(0,0,0,0.4);
        }

        .overlay-card:hover {
          background: rgba(255,255,255,0.06) !important;
          border-color: rgba(255,255,255,0.15) !important;
          transform: translateY(-2px);
        }

        @keyframes overlay-drop {
          from { opacity: 0; transform: translateY(-20px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

        {/* ── Top Navigation Bar ─────────────────────────────────────────── */}
        <div style={{
          height: '60px', background: '#121214', borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', zIndex: 10, flexShrink: 0
        }}>
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/logo.png" alt="HookRelay Logo" style={{ height: 24, display: 'block', filter: 'brightness(0) invert(1)' }} />
            <span style={{ fontSize: '16px', fontWeight: 600, color: '#FAFAFA', letterSpacing: '-0.02em' }}>HookRelay</span>
          </div>

          {/* Global Actions */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => setIsOverlayOpen(true)}
              style={{
                background: '#09090B', border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '6px', color: '#A1A1AA', fontSize: '12px', padding: '6px 12px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                transition: 'all 0.2s ease', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)', outline: 'none'
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#2F2FE4'; e.currentTarget.style.color = '#FAFAFA'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)'; e.currentTarget.style.color = '#A1A1AA'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              Switch Session
              <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', color: '#FAFAFA', fontWeight: 600 }}>⌘K</span>
            </button>
            <button onClick={createNewSession} style={{...btnStyle(true), padding: '6px 16px', fontWeight: 600}}>
              + New Session
            </button>
          </div>
        </div>

        {/* ── Main content (Full Width) ──────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#09090B' }}>
          
          {/* ── Dashboard Control Header ───────────────────────────────────── */}
          <div style={{
            background: '#121214', borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            padding: '16px 32px', display: 'flex', flexDirection: 'column', gap: '12px', zIndex: 5, flexShrink: 0
          }}>
            {/* Row 1: Session & Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#FAFAFA', letterSpacing: '-0.02em' }}>
                  {sessionId}
                </h1>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: '12px',
                  background: connected ? 'rgba(47, 47, 228, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                  border: connected ? '1px solid rgba(47, 47, 228, 0.2)' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: connected ? '#818CF8' : '#A1A1AA', fontSize: '11px', fontWeight: 500
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: connected ? '#2F2FE4' : '#52525B', animation: connected ? 'pulse-dot 2s infinite' : 'none' }} />
                  {connected ? 'Listening' : 'Disconnected'}
                </div>
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={sendTestWebhook} style={btnStyle(false)}>Trigger Test</button>
                <button onClick={clearSession} style={{...btnStyle(false), color: '#FCA5A5', borderColor: 'rgba(239, 68, 68, 0.2)', background: 'transparent'}}>Clear Feed</button>
                <button onClick={() => deleteSession(sessionId)} style={{...btnStyle(false), color: '#FCA5A5', borderColor: 'rgba(239, 68, 68, 0.2)', background: 'transparent'}}>
                  Delete Session
                </button>
              </div>
            </div>

            {/* Row 2: Compact URLs & Forwarding */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', background: '#09090B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', overflow: 'hidden' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#71717A', padding: '0 10px', background: 'rgba(255,255,255,0.02)', height: '100%', display: 'flex', alignItems: 'center', borderRight: '1px solid rgba(255,255,255,0.05)' }}>LOCAL</span>
                <span className="code-font" style={{ flex: 1, fontSize: '12px', color: '#D4D4D8', padding: '6px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{webhookUrl}</span>
                <button onClick={copyLocal} style={{ background: 'transparent', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.05)', color: copiedLocal ? '#818CF8' : '#A1A1AA', fontSize: '11px', padding: '6px 12px', cursor: 'pointer' }}>
                  {copiedLocal ? 'Copied' : 'Copy'}
                </button>
              </div>

              {tunnelUrl && (
                <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', background: '#09090B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', overflow: 'hidden' }}>
                  <span style={{ fontSize: '10px', fontWeight: 600, color: '#71717A', padding: '0 10px', background: 'rgba(255,255,255,0.02)', height: '100%', display: 'flex', alignItems: 'center', borderRight: '1px solid rgba(255,255,255,0.05)' }}>PUBLIC</span>
                  <span className="code-font" style={{ flex: 1, fontSize: '12px', color: '#D4D4D8', padding: '6px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tunnelWebhookUrl}</span>
                  <button onClick={copyTunnel} style={{ background: 'transparent', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.05)', color: copiedTunnel ? '#818CF8' : '#A1A1AA', fontSize: '11px', padding: '6px 12px', cursor: 'pointer' }}>
                    {copiedTunnel ? 'Copied' : 'Copy'}
                  </button>
                </div>
              )}

              <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', background: '#09090B', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', overflow: 'hidden', focusWithin: 'border-color: #2F2FE4' }}>
                <span style={{ fontSize: '10px', fontWeight: 600, color: '#71717A', padding: '0 10px', background: 'rgba(255,255,255,0.02)', height: '100%', display: 'flex', alignItems: 'center', borderRight: '1px solid rgba(255,255,255,0.05)' }}>FWD</span>
                <input 
                  type="text" value={forwardUrl} onChange={e => { setForwardUrl(e.target.value); setForwardSaved(false) }} onKeyDown={handleForwardKeyDown}
                  className="code-font" placeholder="http://localhost:3000/api..."
                  style={{ flex: 1, background: 'transparent', border: 'none', color: '#FAFAFA', fontSize: '12px', padding: '6px 10px', outline: 'none' }}
                />
                <button onClick={saveForwardUrl} style={{ background: forwardSaved ? '#10B981' : 'transparent', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.05)', color: forwardSaved ? '#000' : '#A1A1AA', fontSize: '11px', padding: '6px 12px', cursor: 'pointer', fontWeight: 500 }}>
                  {forwardSaved ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Feed ─────────────────────────────────────────────────────────── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', position: 'relative' }}>
            
            {/* Feed Toolbar */}
            <div style={{ 
              maxWidth: feedLayout === 'list' ? '1000px' : 'none', 
              margin: '0 auto', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <div style={{ color: '#A1A1AA', fontSize: '14px', fontWeight: 500 }}>
                {events.length} {events.length === 1 ? 'Event' : 'Events'} Received
              </div>
              
              {/* Layout Toggle (Segmented Control) */}
              <div style={{ 
                display: 'flex', background: 'rgba(255,255,255,0.03)', 
                borderRadius: '6px', padding: '4px', border: '1px solid rgba(255,255,255,0.05)' 
              }}>
                <button 
                  onClick={() => toggleLayout('list')}
                  style={{
                    ...btnStyle(false), 
                    background: feedLayout === 'list' ? 'rgba(255,255,255,0.1)' : 'transparent',
                    color: feedLayout === 'list' ? '#FAFAFA' : '#71717A',
                    border: 'none', padding: '6px 12px', height: 'auto',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  List
                </button>
                <button 
                  onClick={() => toggleLayout('grid')}
                  style={{
                    ...btnStyle(false), 
                    background: feedLayout === 'grid' ? 'rgba(255,255,255,0.1)' : 'transparent',
                    color: feedLayout === 'grid' ? '#FAFAFA' : '#71717A',
                    border: 'none', padding: '6px 12px', height: 'auto',
                    display: 'flex', alignItems: 'center', gap: '6px'
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                  Grid
                </button>
              </div>
            </div>

            <div style={{ 
              maxWidth: feedLayout === 'list' ? '1000px' : 'none', 
              margin: '0 auto',
              display: feedLayout === 'grid' ? 'grid' : 'block',
              gridTemplateColumns: feedLayout === 'grid' ? 'repeat(auto-fill, minmax(450px, 1fr))' : 'none',
              gap: feedLayout === 'grid' ? '16px' : '0'
            }}>
              {events.length === 0 ? (
                <div style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center', padding: '40px', border: '1px dashed rgba(255,255,255,0.15)', borderRadius: '12px' }}>
                  <div style={{ width: 48, height: 48, background: 'rgba(47,47,228,0.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', border: '1px solid rgba(47,47,228,0.2)', boxShadow: '0 0 16px rgba(47,47,228,0.15)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2F2FE4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
                  </div>
                  <h3 style={{ margin: '0 0 8px', color: '#FAFAFA', fontSize: '16px', fontWeight: 500 }}>Waiting for events</h3>
                  <p style={{ margin: 0, color: '#A1A1AA', fontSize: '13px', lineHeight: 1.5 }}>Your endpoint is live. Point your third-party service to the URL above.</p>
                </div>
              ) : events.map(ev => {
                const badge = getForwardBadge(ev)
                const isReplaying = replayingId === ev.id
                return (
                  <div key={ev.id} className="event-card" style={{
                    background: '#121214', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '10px', padding: '16px', 
                    marginBottom: feedLayout === 'list' ? '16px' : '0',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)'
                  }}>
                    {/* Header row with Actions merged */}
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '10px', flexWrap: 'wrap' }}>
                      <span className="code-font" style={{
                        background: ev.method === 'REPLAY' ? 'rgba(192, 132, 252, 0.1)' : 'rgba(47, 47, 228, 0.1)',
                        color: ev.method === 'REPLAY' ? '#C084FC' : '#818CF8',
                        border: ev.method === 'REPLAY' ? '1px solid rgba(192, 132, 252, 0.2)' : '1px solid rgba(47, 47, 228, 0.2)',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                      }}>
                        {ev.method}
                      </span>
                      <span className="code-font" style={{ color: '#71717A', fontSize: '12px' }}>
                        /hooks/{ev.session_id}
                      </span>

                      {/* Forward status badge */}
                      {badge && (
                        <span style={{
                          background: badge.bg, color: badge.text, border: `1px solid ${badge.border}`,
                          padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500,
                          display: 'flex', alignItems: 'center', gap: '4px'
                        }}>
                          <span style={{ opacity: 0.7 }}>→</span> {badge.label}
                        </span>
                      )}

                      <span style={{ color: '#71717A', fontSize: '11px', fontWeight: 500, marginRight: 'auto', marginLeft: '4px' }}>
                        {new Date(ev.received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      
                      {/* Actions moved to top */}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => downloadEvent(ev)} style={{...btnStyle(false), padding: '4px 10px', fontSize: '11px', background: 'transparent'}}>Download</button>
                        <button onClick={() => replayEvent(ev)} style={{...btnStyle(isReplaying), padding: '4px 10px', fontSize: '11px'}}>
                          {isReplaying ? 'Replayed ✓' : 'Replay Event'}
                        </button>
                      </div>
                    </div>

                    {/* Body Payload (Constrained Height) */}
                    <div style={{ 
                      background: '#09090B', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px',
                      overflow: 'hidden', marginBottom: ev.forward_response ? '12px' : '0',
                      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
                    }}>
                      <div style={{ maxHeight: '250px', overflowY: 'auto', padding: '12px' }}>
                        <pre className="code-font" style={{ color: '#E4E4E7', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                          {ev.body ? parseBody(ev.body) : 'No payload body'}
                        </pre>
                      </div>
                    </div>

                    {/* Forward response (if present) */}
                    {ev.forward_response && (
                      <details>
                        <summary style={{ color: '#A1A1AA', fontSize: '12px', cursor: 'pointer', fontWeight: 500, userSelect: 'none', transition: 'color 0.2s', outline: 'none' }}>
                          Show target response
                        </summary>
                        <div style={{ 
                          marginTop: '8px', background: '#09090B', border: '1px solid rgba(255,255,255,0.05)', 
                          borderRadius: '6px', padding: '12px', maxHeight: '150px', overflowY: 'auto',
                          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
                        }}>
                          <pre className="code-font" style={{ color: '#A1A1AA', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                            {ev.forward_response}
                          </pre>
                        </div>
                      </details>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

      </div>

      {/* ── Overlay Modal ────────────────────────────────────────────────── */}
      {isOverlayOpen && (
        <div 
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100,
            background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh'
          }}
          onClick={() => { setIsOverlayOpen(false); setSearchQuery(''); }}
        >
          <div 
            style={{
              width: '640px', maxWidth: '90vw', background: '#121214', borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
              animation: 'overlay-drop 0.2s ease-out forwards'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Search Input */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ padding: '0 0 0 24px', color: '#52525B' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </div>
              <input
                id="session-search-input"
                autoFocus
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setIsOverlayOpen(false);
                    setSearchQuery('');
                  }
                  if (e.key === 'Enter') {
                    const clean = searchQuery.trim()
                    if (clean) {
                      switchSession(clean)
                      setIsOverlayOpen(false)
                      setSearchQuery('')
                    }
                  }
                }}
                placeholder="Find or create a session..."
                style={{
                  width: '100%', background: 'transparent', border: 'none',
                  color: '#FAFAFA', fontSize: '24px', padding: '24px 20px', outline: 'none',
                  fontFamily: '"Geist", system-ui, sans-serif', fontWeight: 500
                }}
              />
              <div style={{ padding: '0 24px 0 0', color: '#52525B', fontSize: '11px', fontWeight: 600 }}>ESC TO CANCEL</div>
            </div>

            {/* Cards Grid */}
            <div style={{ padding: '24px', maxHeight: '50vh', overflowY: 'auto' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#71717A', letterSpacing: '0.05em', marginBottom: '16px' }}>
                YOUR SESSIONS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                
                {/* Special Create Card if typing a new name */}
                {searchQuery.trim() && !sessions.includes(searchQuery.trim()) && (
                  <div
                    className="overlay-card"
                    onClick={() => { switchSession(searchQuery.trim()); setIsOverlayOpen(false); setSearchQuery(''); }}
                    style={{
                      background: 'rgba(16, 185, 129, 0.1)',
                      border: '1px dashed rgba(16, 185, 129, 0.4)',
                      borderRadius: '10px', padding: '16px', cursor: 'pointer', transition: 'all 0.15s ease',
                      display: 'flex', flexDirection: 'column', gap: '12px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: '#10B981', boxShadow: '0 0 10px rgba(16, 185, 129, 0.8)' }} />
                      <span style={{ color: '#FAFAFA', fontSize: '15px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {searchQuery.trim()}
                      </span>
                    </div>
                    <div style={{ color: '#34D399', fontSize: '12px', fontWeight: 600 }}>
                      Hit Enter to Create
                    </div>
                  </div>
                )}

                {/* Existing Sessions */}
                {filteredSessions.map(s => {
                  const active = s === sessionId;
                  return (
                    <div
                      key={s}
                      className="overlay-card"
                      onClick={() => { switchSession(s); setIsOverlayOpen(false); setSearchQuery(''); }}
                      style={{
                        background: active ? 'rgba(47, 47, 228, 0.1)' : 'rgba(255,255,255,0.03)',
                        border: active ? '1px solid rgba(47, 47, 228, 0.4)' : '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '10px', padding: '16px', cursor: 'pointer', transition: 'all 0.15s ease',
                        display: 'flex', flexDirection: 'column', gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                          background: active ? '#2F2FE4' : '#52525B',
                          boxShadow: active ? '0 0 10px rgba(47, 47, 228, 0.8)' : 'none',
                        }} />
                        <span style={{ color: active ? '#FAFAFA' : '#D4D4D8', fontSize: '15px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {s}
                        </span>
                        
                        {/* Delete Icon */}
                        <div 
                          onClick={e => { e.stopPropagation(); deleteSession(s); }}
                          style={{
                            padding: '4px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.1)',
                            color: '#F87171', display: 'flex', alignItems: 'center', cursor: 'pointer',
                            opacity: 0.6, transition: 'all 0.2s ease'
                          }}
                          onMouseOver={e => e.currentTarget.style.opacity = 1}
                          onMouseOut={e => e.currentTarget.style.opacity = 0.6}
                          title="Delete Session"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </div>
                      </div>
                      <div style={{ color: '#71717A', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                        {active ? <span style={{ color: '#818CF8' }}>Current</span> : <span>Switch</span>}
                      </div>
                    </div>
                  )
                })}

                {filteredSessions.length === 0 && !searchQuery.trim() && (
                  <div style={{ color: '#52525B', fontSize: '14px', gridColumn: '1 / -1' }}>
                    No sessions found. Click "+ New Session" to create one.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}