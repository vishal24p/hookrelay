import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const RECONNECT_BASE_DELAY_MS = 500
const RECONNECT_MAX_DELAY_MS = 15000
const EMPTY_HEADERS = Object.freeze({})
const EVENT_ID_KEYS = ['id', 'event_id', 'eventId', 'delivery_id', 'deliveryId', 'uuid']

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '')
}

function getDefaultApiBaseUrl() {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/api`
}

function normalizeHookArgs(sessionArg, optionsArg, requestHeadersArg) {
  if (sessionArg && typeof sessionArg === 'object' && !Array.isArray(sessionArg)) {
    const sessionId = sessionArg.sessionId || sessionArg.session_id || ''
    return {
      sessionId,
      options: {
        ...sessionArg,
        requestHeaders: sessionArg.requestHeaders || requestHeadersArg || EMPTY_HEADERS,
      },
    }
  }

  return {
    sessionId: sessionArg || '',
    options: {
      ...(optionsArg || {}),
      requestHeaders: requestHeadersArg || optionsArg?.requestHeaders || EMPTY_HEADERS,
    },
  }
}

function normalizeHeaders(headers = EMPTY_HEADERS) {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return { ...headers }
}

export function buildControlHeaders(authToken, requestHeaders, extraHeaders = {}) {
  const headers = {
    ...normalizeHeaders(requestHeaders),
    ...normalizeHeaders(extraHeaders),
  }

  if (authToken && !hasHeader(headers, 'Authorization')) {
    headers.Authorization = `Bearer ${authToken}`
  }

  return headers
}

function hasHeader(headers, headerName) {
  const lowerHeaderName = headerName.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerHeaderName)
}

function randomId(prefix = 'evt') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function wait(ms) {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      setTimeout(resolve, ms)
      return
    }
    window.setTimeout(resolve, ms)
  })
}

async function readResponseJson(response) {
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text }
    }
  }

  if (!response.ok) {
    const message =
      data?.detail ||
      data?.message ||
      data?.error ||
      `Request failed with status ${response.status}.`
    throw new Error(message)
  }

  return data
}

function getEventId(event) {
  for (const key of EVENT_ID_KEYS) {
    if (event?.[key] !== undefined && event?.[key] !== null && event?.[key] !== '') {
      return String(event[key])
    }
  }
  return randomId()
}

function normalizeEvent(rawEvent) {
  if (!rawEvent || typeof rawEvent !== 'object' || Array.isArray(rawEvent)) {
    return {
      id: randomId(),
      body: rawEvent,
      received_at: new Date().toISOString(),
    }
  }

  const id = getEventId(rawEvent)
  return { ...rawEvent, id }
}

export function extractEvents(data) {
  if (Array.isArray(data)) return data.map(normalizeEvent)
  if (Array.isArray(data?.events)) return data.events.map(normalizeEvent)
  if (Array.isArray(data?.items)) return data.items.map(normalizeEvent)
  if (data?.event) return [normalizeEvent(data.event)]
  if (data && typeof data === 'object' && EVENT_ID_KEYS.some((key) => data[key])) {
    return [normalizeEvent(data)]
  }
  return []
}

export function mergeEvents(primaryEvents, secondaryEvents = []) {
  const byId = new Map()
  for (const event of [...primaryEvents, ...secondaryEvents]) {
    if (!event?.id || byId.has(event.id)) continue
    byId.set(event.id, event)
  }
  return Array.from(byId.values())
}

function buildGenericFixture(sessionId) {
  return {
    id: randomId('hookrelay_test'),
    type: 'hookrelay.test',
    created_at: new Date().toISOString(),
    data: {
      object: {
        id: randomId('obj'),
        session_id: sessionId,
        message: 'Test webhook from HookRelay',
      },
    },
  }
}

function getFixtureKey(fixtureArg) {
  if (typeof fixtureArg === 'string' && fixtureArg) return fixtureArg
  if (fixtureArg?.fixtureKey) return fixtureArg.fixtureKey
  return 'payment_captured'
}

function isWebhookPayload(value) {
  return (
    value &&
    typeof value === 'object' &&
    !value.fixtureKey &&
    !value.nativeEvent &&
    typeof value.preventDefault !== 'function'
  )
}

export function getWebSocketOrigin(websocketOrigin, controlApiBase) {
  const rawOrigin = websocketOrigin || controlApiBase || getDefaultApiBaseUrl()
  try {
    const url = rawOrigin instanceof URL ? new URL(rawOrigin.href) : new URL(String(rawOrigin))
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${url.host}`
  } catch {
    if (typeof window === 'undefined') return ''
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}`
  }
}

function setTransientState(setter, value = 'success') {
  setter(value)
  if (typeof window === 'undefined') return
  window.setTimeout(() => {
    setter((prev) => (prev === value ? 'idle' : prev))
  }, 1600)
}

const IDLE_REPLAY_STATE = Object.freeze({ status: 'idle', eventId: null, delivery: null })

function setTransientReplayState(setter, nextState) {
  setter(nextState)
  if (typeof window === 'undefined') return
  window.setTimeout(() => {
    setter((prev) =>
      prev.status === nextState.status && prev.eventId === nextState.eventId
        ? IDLE_REPLAY_STATE
        : prev,
    )
  }, 1600)
}

export function useEventStream(sessionArg = null, optionsArg = null, requestHeadersArg = null) {
  const normalizedArgs = useMemo(
    () => normalizeHookArgs(sessionArg, optionsArg, requestHeadersArg),
    [sessionArg, optionsArg, requestHeadersArg],
  )

  const { sessionId, options } = normalizedArgs
  const controlApiBase = trimTrailingSlash(
    options.controlApiBase || options.apiBaseUrl || options.baseUrl || getDefaultApiBaseUrl(),
  )
  const websocketOrigin = options.websocketOrigin || options.wsOrigin || null
  const authToken = options.authToken || options.token || ''
  const provider = options.provider || 'razorpay'
  const requestHeaders = options.requestHeaders || EMPTY_HEADERS
  const fetchImpl = options.fetch || (typeof fetch !== 'undefined' ? fetch : null)

  const encodedSessionId = encodeURIComponent(sessionId || '')
  const historyUrl = options.historyUrl || `${controlApiBase}/hooks/${encodedSessionId}`
  const clearUrl = options.clearUrl || `${controlApiBase}/hooks/${encodedSessionId}`
  const ingestTestUrl = options.ingestTestUrl || `${controlApiBase}/hooks/${encodedSessionId}`
  const webSocketUrl =
    options.webSocketUrl ||
    options.wsUrl ||
    `${getWebSocketOrigin(websocketOrigin, controlApiBase)}/ws/${encodedSessionId}`

  const [events, setEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [socketState, setSocketState] = useState(sessionId ? 'connecting' : 'idle')
  const [streamError, setStreamError] = useState('')
  const [malformedMessageCount, setMalformedMessageCount] = useState(0)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const [testState, setTestState] = useState('idle')
  const [clearState, setClearState] = useState('idle')
  const [replayState, setReplayState] = useState(IDLE_REPLAY_STATE)
  const [actionError, setActionError] = useState('')
  const [replayingIds, setReplayingIds] = useState(() => new Set())
  const [replayErrors, setReplayErrors] = useState({})
  const lastCursorRef = useRef(null)
  const sessionVersionRef = useRef(0)
  const sessionIdRef = useRef(sessionId)

  if (sessionIdRef.current !== sessionId) {
    sessionIdRef.current = sessionId
    sessionVersionRef.current += 1
  }

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) || null,
    [events, selectedEventId],
  )

  const rememberCursor = useCallback((nextEvents) => {
    lastCursorRef.current = nextEvents[0]?.id || null
  }, [])

  const refreshHistory = useCallback(
    async ({ silent = false, signal = null } = {}) => {
      if (!sessionId || !fetchImpl) return []
      const requestSessionVersion = sessionVersionRef.current
      if (!silent) {
        setLoadingHistory(true)
      }
      setHistoryError('')

      try {
        const data = await readResponseJson(
          await fetchImpl(historyUrl, {
            headers: buildControlHeaders(authToken, requestHeaders),
            signal,
          }),
        )
        if (signal?.aborted) return []
        if (requestSessionVersion !== sessionVersionRef.current) return []

        const historyEvents = extractEvents(data)
        let mergedEvents = historyEvents
        setEvents((prev) => {
          if (requestSessionVersion !== sessionVersionRef.current) return prev
          mergedEvents = mergeEvents(historyEvents, prev)
          rememberCursor(mergedEvents)
          return mergedEvents
        })
        return mergedEvents
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') return []
        const message = error instanceof Error ? error.message : 'Unable to load webhook history.'
        if (requestSessionVersion === sessionVersionRef.current) {
          setHistoryError(message)
        }
        return []
      } finally {
        if (!silent && requestSessionVersion === sessionVersionRef.current) {
          setLoadingHistory(false)
        }
      }
    },
    [authToken, fetchImpl, historyUrl, rememberCursor, requestHeaders, sessionId],
  )

  const clearActionError = useCallback(() => {
    setActionError('')
  }, [])

  const clearEvents = useCallback(() => {
    setEvents([])
    setSelectedEventId(null)
    lastCursorRef.current = null
  }, [])

  const reconnect = useCallback(() => {
    setReconnectNonce((prev) => prev + 1)
  }, [])

  const replayEvent = useCallback(
    async (eventOrId) => {
      const eventId =
        eventOrId && typeof eventOrId === 'object' && eventOrId.id
          ? eventOrId.id
          : typeof eventOrId === 'string' || typeof eventOrId === 'number'
            ? eventOrId
            : selectedEvent?.id
      if (!sessionId || !eventId || !fetchImpl) return

      setReplayState({ status: 'loading', eventId, delivery: null })
      setActionError('')
      setReplayErrors((prev) => {
        const next = { ...prev }
        delete next[eventId]
        return next
      })
      setReplayingIds((prev) => new Set(prev).add(eventId))

      try {
        const replayUrl =
          options.replayUrl ||
          `${controlApiBase}/hooks/${encodedSessionId}/${encodeURIComponent(eventId)}/replay`
        const response = await fetchImpl(replayUrl, {
          method: 'POST',
          headers: buildControlHeaders(authToken, requestHeaders),
        })
        try {
          await readResponseJson(response)
        } catch (error) {
          if (response.status === 502) {
            const message =
              error instanceof Error
                ? error.message
                : 'Replay sent but the local handler was unreachable.'
            setTransientReplayState(setReplayState, {
              status: 'success',
              eventId,
              delivery: 'failed',
            })
            setActionError(message)
            setReplayErrors((prev) => ({ ...prev, [eventId]: message }))
            await refreshHistory({ silent: true })
            return
          }
          throw error
        }
        setTransientReplayState(setReplayState, {
          status: 'success',
          eventId,
          delivery: 'delivered',
        })
        await refreshHistory({ silent: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Replaying the webhook failed.'
        setReplayState({ status: 'error', eventId, delivery: null })
        setActionError(message)
        setReplayErrors((prev) => ({ ...prev, [eventId]: message }))
      } finally {
        setReplayingIds((prev) => {
          const next = new Set(prev)
          next.delete(eventId)
          return next
        })
      }
    },
    [
      authToken,
      controlApiBase,
      encodedSessionId,
      fetchImpl,
      options.replayUrl,
      refreshHistory,
      requestHeaders,
      selectedEvent,
      sessionId,
    ],
  )

  const sendTestWebhook = useCallback(
    async (fixtureArg) => {
      if (!sessionId || !fetchImpl) return
      setTestState('loading')
      setActionError('')

      try {
        if (provider === 'razorpay') {
          const fixtureKey = getFixtureKey(fixtureArg)
          const fixtureUrl =
            options.fixtureUrl ||
            `${controlApiBase}/sessions/${encodedSessionId}/razorpay-fixtures/${encodeURIComponent(
              fixtureKey,
            )}`
          await readResponseJson(
            await fetchImpl(fixtureUrl, {
              method: 'POST',
              headers: buildControlHeaders(authToken, requestHeaders),
            }),
          )
        } else {
          const payload = isWebhookPayload(fixtureArg) ? fixtureArg : buildGenericFixture(sessionId)
          await readResponseJson(
            await fetchImpl(ingestTestUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }),
          )
        }

        setTransientState(setTestState)
        await wait(150)
        await refreshHistory({ silent: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sending the test webhook failed.'
        setTestState('error')
        setActionError(message)
      }
    },
    [
      authToken,
      controlApiBase,
      encodedSessionId,
      fetchImpl,
      ingestTestUrl,
      options.fixtureUrl,
      provider,
      refreshHistory,
      requestHeaders,
      sessionId,
    ],
  )

  const clearSession = useCallback(async () => {
    if (!sessionId || !fetchImpl) return
    setClearState('loading')
    setActionError('')

    try {
      await readResponseJson(
        await fetchImpl(clearUrl, {
          method: 'DELETE',
          headers: buildControlHeaders(authToken, requestHeaders),
        }),
      )
      clearEvents()
      setTransientState(setClearState)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Clearing webhook history failed.'
      setClearState('error')
      setActionError(message)
    }
  }, [authToken, clearEvents, clearUrl, fetchImpl, requestHeaders, sessionId])

  const downloadEvent = useCallback(
    (eventOrId = selectedEvent) => {
      const event =
        eventOrId && typeof eventOrId === 'object' && eventOrId.id
          ? eventOrId
          : typeof eventOrId === 'string' || typeof eventOrId === 'number'
            ? events.find((candidate) => candidate.id === eventOrId) || selectedEvent
            : selectedEvent

      if (!event || typeof document === 'undefined') {
        setActionError('Select an event before downloading it.')
        return
      }

      const blob = new Blob([JSON.stringify(event, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `hookrelay-event-${event.id}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    },
    [events, selectedEvent],
  )

  useEffect(() => {
    setEvents([])
    setSelectedEventId(null)
    setHistoryError('')
    setStreamError('')
    setMalformedMessageCount(0)
    setReconnectAttempts(0)
    setTestState('idle')
    setClearState('idle')
    setReplayState(IDLE_REPLAY_STATE)
    setActionError('')
    setReplayErrors({})
    setReplayingIds(new Set())
    lastCursorRef.current = null
  }, [sessionId])

  useEffect(() => {
    setSelectedEventId((prev) => {
      if (prev && events.some((event) => event.id === prev)) return prev
      return events[0]?.id || null
    })
  }, [events])

  useEffect(() => {
    if (!sessionId) {
      setSocketState('idle')
      return undefined
    }

    const controller = new AbortController()
    let cancelled = false
    let socket = null
    let reconnectTimer = null
    let attempt = 0

    function scheduleReconnect() {
      attempt += 1
      setReconnectAttempts(attempt)
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS)
      reconnectTimer = window.setTimeout(connect, delay)
    }

    function connect() {
      if (cancelled || controller.signal.aborted || typeof WebSocket === 'undefined') return
      setSocketState('connecting')
      setStreamError('')

      try {
        socket = new WebSocket(webSocketUrl)
      } catch (error) {
        setSocketState('error')
        setStreamError(error instanceof Error ? error.message : 'Unable to open the event stream.')
        scheduleReconnect()
        return
      }

      socket.onopen = async () => {
        if (cancelled) return
        attempt = 0
        setReconnectAttempts(0)
        setSocketState('connected')
        await refreshHistory({ silent: true })
      }

      socket.onmessage = (message) => {
        if (cancelled) return
        try {
          const data = JSON.parse(message.data)
          const nextEvents = extractEvents(data)
          if (nextEvents.length === 0) return
          setEvents((prev) => {
            const mergedEvents = mergeEvents(nextEvents, prev)
            rememberCursor(mergedEvents)
            return mergedEvents
          })
        } catch {
          setMalformedMessageCount((prev) => prev + 1)
        }
      }

      socket.onerror = () => {
        if (cancelled) return
        setSocketState('error')
        setStreamError('The event stream reported a connection error.')
      }

      socket.onclose = () => {
        if (cancelled) return
        setSocketState('disconnected')
        scheduleReconnect()
      }
    }

    async function startStream() {
      await refreshHistory({ signal: controller.signal })
      if (cancelled || controller.signal.aborted) return
      if (typeof WebSocket === 'undefined') {
        setSocketState('disconnected')
        return
      }
      connect()
    }

    startStream()

    return () => {
      cancelled = true
      controller.abort()
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer)
      }
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close()
      }
    }
  }, [reconnectNonce, refreshHistory, rememberCursor, sessionId, webSocketUrl])

  const replayingEventIds = useMemo(() => Array.from(replayingIds), [replayingIds])
  const loading = loadingHistory
  const error = historyError
  const connectionStatus = socketState

  return {
    events,
    setEvents,
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
    loading,
    isLoading: loading,
    error,
    streamError,
    connectionStatus,
    status: connectionStatus,
    isConnected: connectionStatus === 'connected',
    reconnectAttempts,
    malformedMessageCount,
    replayingIds,
    replayingEventIds,
    replayLoading: replayingIds.size > 0,
    isReplaying: replayingIds.size > 0,
    replayErrors,
    lastEventCursor: lastCursorRef.current,
    refreshHistory,
    loadHistory: refreshHistory,
    reload: refreshHistory,
    clearEvents,
    reconnect,
    replay: replayEvent,
    apiState: {
      loading,
      error,
      connectionStatus,
      replayErrors,
    },
  }
}

export default useEventStream
