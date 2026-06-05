import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEndpointState } from '../useEndpointState.jsx'

function jsonResponse(data, init = {}) {
  return Promise.resolve({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(data)),
  })
}

describe('useEndpointState', () => {
  beforeEach(() => {
    window.location.hash = ''
    localStorage.clear()
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const urlText = String(url)
      if (urlText.endsWith('/sessions')) {
        return jsonResponse(['server-endpoint'])
      }
      if (urlText.includes('/hooks/')) {
        return jsonResponse([])
      }
      return jsonResponse({})
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
    window.location.hash = ''
  })

  it('falls back to empty local state when storage reads fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    const { result } = renderHook(() => useEndpointState({ controlApiBase: 'http://api.test' }))

    expect(result.current.sessionId).toBeTruthy()
    expect(result.current.localEndpoints.length).toBeGreaterThanOrEqual(1)
  })

  it('keeps in-memory endpoint state when storage writes fail', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('quota exceeded')
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })

    const { result } = renderHook(() => useEndpointState({ controlApiBase: 'http://api.test' }))

    act(() => {
      result.current.createEndpoint('Quota Endpoint', 'quota-endpoint')
    })

    await waitFor(() => expect(result.current.sessionId).toBe('quota-endpoint'))
    expect(result.current.currentEndpoint.name).toBe('Quota Endpoint')
    await waitFor(() => expect(result.current.storageError).not.toBeNull())
    expect(['hookrelay_history', 'hookrelay_endpoint_labels']).toContain(
      result.current.storageError.key,
    )
  })

  it('clears surfaced storage errors', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        const error = new Error('quota')
        error.name = 'QuotaExceededError'
        throw error
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })

    const { result } = renderHook(() => useEndpointState({ controlApiBase: 'http://api.test' }))

    await waitFor(() => expect(result.current.storageError).not.toBeNull())

    act(() => {
      result.current.clearStorageError()
    })

    expect(result.current.storageError).toBeNull()
  })

  it('keeps stale summary defaults when summary polling fails', async () => {
    globalThis.fetch.mockImplementation((url) => {
      const urlText = String(url)
      if (urlText.endsWith('/sessions')) {
        return jsonResponse(['server-endpoint'])
      }
      if (urlText.includes('/hooks/server-endpoint')) {
        return jsonResponse({ detail: 'unavailable' }, { ok: false, status: 503 })
      }
      return jsonResponse([])
    })

    const { result } = renderHook(() => useEndpointState({ controlApiBase: 'http://api.test' }))

    await waitFor(() => expect(result.current.sessionsLoading).toBe(false))
    await waitFor(() =>
      expect(
        result.current.serverEndpoints.find((endpoint) => endpoint.id === 'server-endpoint'),
      ).toMatchObject({
        count: 0,
        lastActivity: null,
      }),
    )
  })
})
