import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildControlHeaders,
  extractEvents,
  getWebSocketOrigin,
  mergeEvents,
  useEventStream,
} from '../useEventStream.jsx'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

function jsonResponse(data, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  }
}

function event(id, overrides = {}) {
  return {
    id,
    provider_event_type: `payment.${id}`,
    received_at: '2026-06-04T12:00:00.000Z',
    body: '{}',
    ...overrides,
  }
}

let sockets = []
let originalWebSocket

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor(url) {
    this.url = url
    this.readyState = FakeWebSocket.CONNECTING
    this.closeCount = 0
    this.closedByClient = false
    sockets.push(this)
  }

  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.({ target: this })
  }

  emitMessage(payload) {
    this.onmessage?.({ data: JSON.stringify(payload), target: this })
  }

  closeFromServer() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ target: this })
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.closedByClient = true
    this.closeCount += 1
  }
}

describe('useEventStream pure helpers', () => {
  it('extracts and normalizes events from supported response shapes', () => {
    expect(extractEvents([{ event_id: 42, body: 'a' }])).toEqual([
      { event_id: 42, body: 'a', id: '42' },
    ])
    expect(extractEvents({ events: [{ deliveryId: 'delivery-1' }] })).toEqual([
      { deliveryId: 'delivery-1', id: 'delivery-1' },
    ])
    expect(extractEvents({ event: { uuid: 'event-uuid' } })).toEqual([
      { uuid: 'event-uuid', id: 'event-uuid' },
    ])
    expect(extractEvents({ ignored: true })).toEqual([])
  })

  it('merges primary events first and drops duplicate ids', () => {
    expect(
      mergeEvents(
        [
          { id: 'newer', body: 'primary' },
          { id: 'same', body: 'primary wins' },
        ],
        [
          { id: 'same', body: 'secondary loses' },
          { id: 'older', body: 'secondary' },
        ],
      ),
    ).toEqual([
      { id: 'newer', body: 'primary' },
      { id: 'same', body: 'primary wins' },
      { id: 'older', body: 'secondary' },
    ])
  })

  it('builds auth headers without overriding caller-provided authorization', () => {
    expect(buildControlHeaders('token-a', { 'X-Trace': '1' })).toEqual({
      'X-Trace': '1',
      Authorization: 'Bearer token-a',
    })
    expect(buildControlHeaders('token-a', { authorization: 'Bearer caller' })).toEqual({
      authorization: 'Bearer caller',
    })
  })

  it('derives websocket origins from API origins', () => {
    expect(getWebSocketOrigin(null, 'http://localhost:8080/api')).toBe('ws://localhost:8080')
    expect(getWebSocketOrigin(null, 'https://hooks.example.test/api')).toBe(
      'wss://hooks.example.test',
    )
  })
})

describe('useEventStream hook behavior', () => {
  beforeEach(() => {
    sockets = []
    originalWebSocket = globalThis.WebSocket
    globalThis.WebSocket = FakeWebSocket
    window.WebSocket = FakeWebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    sockets = []

    if (originalWebSocket) {
      globalThis.WebSocket = originalWebSocket
      window.WebSocket = originalWebSocket
    } else {
      delete globalThis.WebSocket
      delete window.WebSocket
    }
  })

  it('opens the WebSocket only after history loads', async () => {
    const history = deferred()
    const fetchImpl = vi.fn(() => history.promise)

    const { result } = renderHook(() =>
      useEventStream('session-a', {
        controlApiBase: 'http://api.test',
        fetch: fetchImpl,
      }),
    )

    expect(sockets).toHaveLength(0)

    await act(async () => {
      history.resolve(jsonResponse({ events: [event('history-1')] }))
      await history.promise
    })

    await waitFor(() => expect(sockets).toHaveLength(1))
    expect(result.current.events.map(({ id }) => id)).toEqual(['history-1'])
    expect(result.current.lastEventCursor).toBe('history-1')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/hooks/session-a',
      expect.objectContaining({ headers: {}, signal: expect.any(AbortSignal) }),
    )
  })

  it('reconnects after close using exponential backoff delays', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ events: [] })))

    const { result } = renderHook(() =>
      useEventStream('session-a', {
        controlApiBase: 'http://api.test',
        fetch: fetchImpl,
      }),
    )

    await waitFor(() => expect(sockets).toHaveLength(1))
    vi.useFakeTimers()

    act(() => {
      sockets[0].closeFromServer()
    })

    expect(result.current.socketState).toBe('disconnected')
    expect(result.current.reconnectAttempts).toBe(1)

    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(sockets).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(sockets).toHaveLength(2)

    act(() => {
      sockets[1].closeFromServer()
    })
    expect(result.current.reconnectAttempts).toBe(2)

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(sockets).toHaveLength(2)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(sockets).toHaveLength(3)
  })

  it('ignores stale history and socket messages after switching sessions', async () => {
    const oldHistory = deferred()
    const newHistory = deferred()
    let abortObserved = false
    const fetchImpl = vi.fn((url, options = {}) => {
      if (String(url).includes('/old-session')) {
        options.signal?.addEventListener('abort', () => {
          abortObserved = true
        })
        return oldHistory.promise
      }
      return newHistory.promise
    })

    const { result, rerender } = renderHook(
      ({ sessionId }) =>
        useEventStream(sessionId, {
          controlApiBase: 'http://api.test',
          fetch: fetchImpl,
        }),
      { initialProps: { sessionId: 'old-session' } },
    )

    expect(sockets).toHaveLength(0)

    rerender({ sessionId: 'new-session' })

    await waitFor(() => expect(abortObserved).toBe(true))
    expect(sockets).toHaveLength(0)

    await act(async () => {
      newHistory.resolve(jsonResponse({ events: [event('new-history', { session_id: 'new' })] }))
      await newHistory.promise
    })

    await waitFor(() => expect(sockets).toHaveLength(1))
    expect(sockets[0].url).toBe('ws://api.test/ws/new-session')

    await waitFor(() =>
      expect(result.current.events.map(({ id }) => id)).toEqual(['new-history']),
    )

    await act(async () => {
      oldHistory.resolve(jsonResponse({ events: [event('old-history', { session_id: 'old' })] }))
      await oldHistory.promise
    })
    expect(result.current.events.map(({ id }) => id)).toEqual(['new-history'])
    expect(result.current.events.some(({ session_id }) => session_id === 'old')).toBe(false)
  })

  it('records replay failure status for the affected event', async () => {
    const fetchImpl = vi.fn((url, init = {}) => {
      if (init.method === 'POST' && String(url).endsWith('/evt-1/replay')) {
        return Promise.resolve(
          jsonResponse({ detail: 'Local handler refused the replay.' }, { ok: false, status: 502 }),
        )
      }

      return Promise.resolve(jsonResponse({ events: [event('evt-1')] }))
    })

    const { result } = renderHook(() =>
      useEventStream('session-a', {
        controlApiBase: 'http://api.test',
        fetch: fetchImpl,
      }),
    )

    await waitFor(() => expect(result.current.events.map(({ id }) => id)).toEqual(['evt-1']))

    await act(async () => {
      await result.current.replayEvent('evt-1')
    })

    expect(result.current.replayState).toEqual({
      status: 'success',
      eventId: 'evt-1',
      delivery: 'failed',
    })
    expect(result.current.actionError).toBe('Local handler refused the replay.')
    expect(result.current.replayErrors).toEqual({ 'evt-1': 'Local handler refused the replay.' })
    expect(result.current.replayingEventIds).toEqual([])
  })
})
