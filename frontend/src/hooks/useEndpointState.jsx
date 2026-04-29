import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  generateSessionId,
  getErrorMessage,
  getSessionFromUrl,
  readJson,
} from '../ui.js'

const HISTORY_KEY = 'hookrelay_history'
const LABELS_KEY = 'hookrelay_endpoint_labels'

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function uniqueIds(ids) {
  return Array.from(new Set(ids.filter(Boolean)))
}

function sortEndpoints(a, b) {
  if (a.isCurrent) return -1
  if (b.isCurrent) return 1
  const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0
  const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0
  return bTime - aTime
}

export function useEndpointState({ controlApiBase }) {
  const [sessionId, setSessionId] = useState(() => {
    const fromUrl = getSessionFromUrl()
    if (fromUrl) return fromUrl
    const next = generateSessionId()
    window.location.hash = next
    return next
  })
  const [history, setHistory] = useState(() => readStorage(HISTORY_KEY, []))
  const [labels, setLabels] = useState(() => readStorage(LABELS_KEY, {}))
  const [backendSessions, setBackendSessions] = useState([])
  const [sessionSummaries, setSessionSummaries] = useState({})
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [createFormOpen, setCreateFormOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createId, setCreateId] = useState('')

  const rememberSession = useCallback((nextId) => {
    setHistory((prev) => {
      const next = uniqueIds([nextId, ...prev]).slice(0, 50)
      writeStorage(HISTORY_KEY, next)
      return next
    })
  }, [])

  const saveLabel = useCallback((nextId, nextName) => {
    const cleanName = nextName.trim()
    setLabels((prev) => {
      const next = { ...prev }
      if (!cleanName || cleanName === nextId) {
        delete next[nextId]
      } else {
        next[nextId] = cleanName
      }
      writeStorage(LABELS_KEY, next)
      return next
    })
  }, [])

  const switchEndpoint = useCallback((nextId) => {
    const clean = nextId.trim()
    if (!clean) return
    window.location.hash = clean
    setSessionId(clean)
    rememberSession(clean)
    setSearchQuery('')
  }, [rememberSession])

  const createEndpoint = useCallback((fallbackName = '', forcedId = '') => {
    const endpointId = forcedId.trim() || createId.trim() || generateSessionId()
    const endpointName = createName.trim() || fallbackName || endpointId
    saveLabel(endpointId, endpointName)
    switchEndpoint(endpointId)
    setCreateName('')
    setCreateId('')
  }, [createId, createName, saveLabel, switchEndpoint])

  const deleteEndpointLocal = useCallback((endpointId) => {
    setBackendSessions((prev) => prev.filter((id) => id !== endpointId))
    setHistory((prev) => {
      const next = prev.filter((id) => id !== endpointId)
      writeStorage(HISTORY_KEY, next)
      return next
    })
    setLabels((prev) => {
      const next = { ...prev }
      delete next[endpointId]
      writeStorage(LABELS_KEY, next)
      return next
    })
    setSessionSummaries((prev) => {
      const next = { ...prev }
      delete next[endpointId]
      return next
    })
  }, [])

  const syncCurrentSummary = useCallback((activeId, events) => {
    setSessionSummaries((prev) => ({
      ...prev,
      [activeId]: {
        count: events.length,
        lastActivity: events[0]?.received_at || null,
      },
    }))
  }, [])

  useEffect(() => {
    rememberSession(sessionId)
  }, [])

  useEffect(() => {
    function onHashChange() {
      const id = window.location.hash.replace('#', '')
      if (id && id !== sessionId) {
        setSessionId(id)
        rememberSession(id)
      }
    }

    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [sessionId])

  useEffect(() => {
    function onStorage(event) {
      if (event.key === HISTORY_KEY && event.newValue) {
        setHistory(JSON.parse(event.newValue))
      }
      if (event.key === LABELS_KEY && event.newValue) {
        setLabels(JSON.parse(event.newValue))
      }
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchSessions() {
      setSessionsLoading(true)
      try {
        const data = await readJson(await fetch(`${controlApiBase}/sessions`))
        if (cancelled) return
        setBackendSessions(Array.isArray(data) ? data : [])
        setSessionsError('')
      } catch (error) {
        if (cancelled) return
        setSessionsError(getErrorMessage(error, 'Unable to load endpoints from HookRelay.'))
      } finally {
        if (!cancelled) setSessionsLoading(false)
      }
    }

    fetchSessions()
    const interval = window.setInterval(fetchSessions, 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [controlApiBase])

  const knownIds = useMemo(
    () => uniqueIds([sessionId, ...history, ...backendSessions]),
    [backendSessions, history, sessionId],
  )
  const backendSessionSet = useMemo(() => new Set(backendSessions), [backendSessions])

  useEffect(() => {
    let cancelled = false
    if (knownIds.length === 0) return undefined

    async function fetchSummaries() {
      const entries = await Promise.all(
        knownIds.map(async (id) => {
          try {
            const data = await readJson(await fetch(`${controlApiBase}/hooks/${id}`))
            const events = Array.isArray(data) ? data : []
            return [
              id,
              {
                count: events.length,
                lastActivity: events[0]?.received_at || null,
              },
            ]
          } catch {
            return [id, sessionSummaries[id] || { count: 0, lastActivity: null }]
          }
        }),
      )

      if (!cancelled) {
        setSessionSummaries((prev) => ({ ...prev, ...Object.fromEntries(entries) }))
      }
    }

    fetchSummaries()
    return () => {
      cancelled = true
    }
  }, [controlApiBase, knownIds.join('|')])

  const allEndpoints = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return knownIds
      .map((id) => {
        const summary = sessionSummaries[id] || { count: 0, lastActivity: null }
        const name = labels[id] || id
        const isServer = backendSessionSet.has(id)
        const source = isServer ? 'server' : id === sessionId ? 'current_unsaved' : 'local_history'
        return {
          id,
          name,
          count: summary.count,
          lastActivity: summary.lastActivity,
          isCurrent: id === sessionId,
          source,
        }
      })
      .filter((endpoint) => {
        if (!query) return true
        return (
          endpoint.name.toLowerCase().includes(query) ||
          endpoint.id.toLowerCase().includes(query)
        )
      })
      .sort(sortEndpoints)
  }, [backendSessionSet, knownIds, labels, searchQuery, sessionId, sessionSummaries])

  const serverEndpoints = useMemo(
    () => allEndpoints.filter((endpoint) => endpoint.source === 'server'),
    [allEndpoints],
  )

  const localEndpoints = useMemo(
    () => allEndpoints.filter((endpoint) => endpoint.source !== 'server'),
    [allEndpoints],
  )

  const currentEndpoint = useMemo(
    () => allEndpoints.find((endpoint) => endpoint.id === sessionId) || {
      id: sessionId,
      name: labels[sessionId] || sessionId,
      count: sessionSummaries[sessionId]?.count || 0,
      lastActivity: sessionSummaries[sessionId]?.lastActivity || null,
      isCurrent: true,
      source: 'current_unsaved',
    },
    [allEndpoints, labels, sessionId, sessionSummaries],
  )

  return {
    sessionId,
    serverEndpoints,
    localEndpoints,
    allEndpoints,
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
  }
}
