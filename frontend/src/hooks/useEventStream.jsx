import { useEffect, useMemo, useRef, useState } from 'react'
import { getErrorMessage, readJson } from '../ui.js'

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function useEventStream({ sessionId, controlApiBase, websocketOrigin }) {
  const [events, setEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [socketState, setSocketState] = useState('connecting')
  const [testState, setTestState] = useState('idle')
  const [clearState, setClearState] = useState('idle')
  const [replayState, setReplayState] = useState({ status: 'idle', eventId: null })
  const [actionError, setActionError] = useState('')

  const wsRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      setLoadingHistory(true)
      setHistoryError('')
      try {
        const data = await readJson(await fetch(`${controlApiBase}/hooks/${sessionId}`))
        if (cancelled) return
        setEvents(Array.isArray(data) ? data : [])
      } catch (error) {
        if (cancelled) return
        setHistoryError(getErrorMessage(error, 'Unable to load event history for this endpoint.'))
        setEvents([])
      } finally {
        if (!cancelled) setLoadingHistory(false)
      }
    }

    loadHistory()
    return () => {
      cancelled = true
    }
  }, [controlApiBase, sessionId])

  useEffect(() => {
    setSelectedEventId((prev) => {
      if (events.length === 0) return null
      if (prev && events.some((event) => event.id === prev)) return prev
      return events[0].id
    })
  }, [events])

  useEffect(() => {
    let cancelled = false
    let reconnectTimer = null
    let intentionalClose = false

    function connect() {
      if (cancelled) return
      setSocketState((prev) => (prev === 'connected' ? prev : 'connecting'))
      const protocol = websocketOrigin.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${websocketOrigin.host}/ws/${sessionId}`)

      socket.onopen = () => {
        if (intentionalClose || cancelled) {
          socket.close()
          return
        }
        if (!cancelled) {
          setSocketState('connected')
        }
      }

      socket.onmessage = (message) => {
        if (cancelled) return
        const incoming = JSON.parse(message.data)
        setEvents((prev) => {
          const index = prev.findIndex((event) => event.id === incoming.id)
          if (index !== -1) {
            const next = [...prev]
            next[index] = incoming
            return next
          }
          return [incoming, ...prev]
        })
      }

      socket.onerror = () => {}
      socket.onclose = () => {
        if (cancelled || intentionalClose) return
        setSocketState('disconnected')
        reconnectTimer = window.setTimeout(connect, 2000)
      }

      wsRef.current = socket
    }

    connect()

    return () => {
      cancelled = true
      intentionalClose = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (wsRef.current) {
        wsRef.current.onopen = null
        wsRef.current.onmessage = null
        wsRef.current.onerror = null
        wsRef.current.onclose = null
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close()
        }
      }
      wsRef.current = null
    }
  }, [sessionId, websocketOrigin.host, websocketOrigin.protocol])

  async function sendTestWebhook() {
    setTestState('loading')
    setActionError('')
    try {
      const response = await fetch(`${controlApiBase}/hooks/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'payment.captured',
          order_id: `order_${Math.random().toString(36).slice(2, 10)}`,
          amount: Math.floor(Math.random() * 9000) + 1000,
          currency: 'USD',
          status: 'success',
        }),
      })
      await readJson(response)
      setTestState('success')
      await wait(1200)
      setTestState('idle')
    } catch (error) {
      setTestState('error')
      setActionError(getErrorMessage(error, 'Sending the test event failed.'))
      throw error
    }
  }

  async function clearSession() {
    setClearState('loading')
    setActionError('')
    try {
      const response = await fetch(`${controlApiBase}/hooks/${sessionId}`, { method: 'DELETE' })
      await readJson(response)
      setEvents([])
      setSelectedEventId(null)
      setClearState('success')
      await wait(1200)
      setClearState('idle')
    } catch (error) {
      setClearState('error')
      setActionError(getErrorMessage(error, 'Clearing the event feed failed.'))
      throw error
    }
  }

  async function replayEvent(eventId) {
    setReplayState({ status: 'loading', eventId })
    setActionError('')
    try {
      const response = await fetch(`${controlApiBase}/hooks/${sessionId}/${eventId}/replay`, {
        method: 'POST',
      })
      await readJson(response)
      setReplayState({ status: 'success', eventId })
      await wait(1200)
      setReplayState({ status: 'idle', eventId: null })
    } catch (error) {
      setReplayState({ status: 'error', eventId })
      setActionError(getErrorMessage(error, 'Replaying this event failed.'))
    }
  }

  function downloadEvent(event) {
    const text = event?.body || ''
    let filename = `${event.session_id}-${event.id}`
    try {
      JSON.parse(text)
      filename += '.json'
    } catch {
      filename += '.txt'
    }

    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) || null,
    [events, selectedEventId],
  )

  return {
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
    clearActionError: () => setActionError(''),
    sendTestWebhook,
    clearSession,
    replayEvent,
    downloadEvent,
  }
}
