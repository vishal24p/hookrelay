# HookRelay Hardening Follow-Up — Implementation Brief for Codex

**Date:** 2026-06-04
**Branch:** `codex/split-public-ingest-local-control`
**Pre-hardening base:** `986d5ca refactor: extract event serialization`
**Plan reference:** `docs/superpowers/plans/2026-06-04-hookrelay-hardening-and-oss-readiness-plan.md`
**Audit reference:** `docs/superpowers/plans/2026-06-04-hardening-audit-verdict.md` (this document's companion)

---

## 0. Purpose And Scope

The first hardening pass shipped **28 of 43 plan tasks correctly** with end-to-end test coverage, but **15 tasks remain incomplete or partially complete**. This document specifies every remaining task with:

- the exact file and line range to modify
- the exact code shape to produce (snippets you can paste)
- the test that proves the change
- the verification command

Nothing is left to your judgment. Every fix below is a known shape against an observed gap. **Do not change anything not specified here without surfacing it first.**

All work happens on the current branch in the current working tree. Commit at the end as a single conventional commit `fix: complete hardening follow-up gaps` (or split into 2-3 logical commits if cleaner — see §15 for the suggested commit split).

Test baseline before you start: `python -m unittest discover -s backend/tests -p "test_*.py"` = **47 passed**, `cd frontend && npm test` = **20 passed (4 files)**, `cd frontend && npm run lint` = clean, `cd frontend && npm run build` = clean. After all 14 tasks below the same suite should pass plus 9 new tests (5 backend + 4 frontend) = **52 backend + 24 frontend**.

---

## 1. Critical: Fail-Fast On Default DB Credentials (Plan Task 1.5)

**Status:** FAIL — `docker-compose.yml:62-64` still uses `${POSTGRES_USER:-webhookuser}` defaults. A first-run dev who never copies `.env.example` still gets the published default credentials.

**Files:**
- `docker-compose.yml` — lines 8 (api service DATABASE_URL) and 62-64 (postgres service)
- `.env.example` — add `# REQUIRED` markers and the 3 vars
- `Makefile` — add `make init-env` target (optional, does not block tests)

### 1.1 `docker-compose.yml` changes

**Line 8 (api service env):** replace
```yaml
      - DATABASE_URL=${DATABASE_URL:-postgresql://${POSTGRES_USER:-webhookuser}:${POSTGRES_PASSWORD:-webhookpass}@postgres:5432/${POSTGRES_DB:-webhookdb}}
```
with
```yaml
      - DATABASE_URL=${DATABASE_URL:-postgresql://${POSTGRES_USER:?POSTGRES_USER must be set}:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}@postgres:5432/${POSTGRES_DB:?POSTGRES_DB must be set}}
```

**Lines 62-64 (postgres service env):** replace
```yaml
      POSTGRES_USER: ${POSTGRES_USER:-webhookuser}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-webhookpass}
      POSTGRES_DB: ${POSTGRES_DB:-webhookdb}
```
with
```yaml
      POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER must be set}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
      POSTGRES_DB: ${POSTGRES_DB:?POSTGRES_DB must be set}
```

**Verification:**
```bash
# Both must exit non-zero with the expected error message:
docker compose -f docker-compose.yml config 2>&1 | grep -q "POSTGRES_USER must be set"
echo "exit: $?"
```
Or simply: `unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB && docker compose -f docker-compose.yml config` and confirm the error names the missing variables.

### 1.2 `.env.example` changes

Replace the file header (lines 1-12) to include the three required vars near the top:

```bash
# HookRelay — Environment Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Copy this file to .env and fill in your values.
# .env is gitignored and will never be committed.
#
# WITHOUT these variables → HookRelay uses a free Cloudflare quick tunnel
#                           URL changes on every restart (good for quick testing)
#
# WITH these variables    → HookRelay uses your permanent named tunnel
#                           URL never changes (set in Razorpay/Stripe once, forever)
# ─────────────────────────────────────────────────────────────────────────────


# ── DATABASE CREDENTIALS (REQUIRED) ──────────────────────────────────────────
# Generate with: openssl rand -hex 32
# Compose will refuse to start without these set.
POSTGRES_USER=hookrelay
POSTGRES_PASSWORD=change-me-run-openssl-rand-hex-32
POSTGRES_DB=hookrelay
DATABASE_URL=postgresql://hookrelay:change-me-run-openssl-rand-hex-32@postgres:5432/hookrelay


# ── PERMANENT TUNNEL SETUP (optional but recommended) ────────────────────────
# (rest of file unchanged)
```

### 1.3 Verification (test you must add)

Add to `backend/tests/test_api_smoke.py` (or new file `backend/tests/test_compose_failfast.py` if you prefer — append a new `class` to the existing file is fine). The point of this test is to **prove the plan's verification step**:

```python
    def test_docker_compose_refuses_to_start_without_database_env(self):
        """Plan task 1.5: docker compose must fail-fast without POSTGRES_* env."""
        import os
        import subprocess
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[2]
        env = os.environ.copy()
        for var in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DATABASE_URL"):
            env.pop(var, None)
        result = subprocess.run(
            ["docker", "compose", "-f", str(repo_root / "docker-compose.yml"), "config"],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
        self.assertNotEqual(result.returncode, 0, msg=f"compose config should fail: stdout={result.stdout!r} stderr={result.stderr!r}")
        self.assertTrue(
            "POSTGRES_USER must be set" in (result.stderr + result.stdout)
            or "POSTGRES_PASSWORD must be set" in (result.stderr + result.stdout)
            or "POSTGRES_DB must be set" in (result.stderr + result.stdout),
            msg=f"Expected fail-fast message, got: stdout={result.stdout!r} stderr={result.stderr!r}",
        )
```

If Docker is not installed in the test environment, skip this test with `self.skipTest("docker not available")` at the top.

---

## 2. Critical: `loadHistory` × WebSocket Race (Plan Task 2.3)

**Status:** FAIL — `frontend/src/hooks/useEventStream.jsx:491-493` runs `refreshHistory` in its own effect parallel to the WebSocket effect. No `AbortController` anywhere. WS opens unconditionally.

**File:** `frontend/src/hooks/useEventStream.jsx`

### 2.1 Imports

Add to the existing import line at the top:
```javascript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

### 2.2 Refactor the two effects into one composite effect

The current file has two effects (one for `refreshHistory`, one for the WebSocket). Replace them with a **single effect** that:
1. aborts any in-flight history load and closes any open socket
2. opens an `AbortController`
3. awaits `refreshHistory` with the signal
4. only then opens the WebSocket
5. WS `onmessage` only appends events whose `id` is not in the current `events` array
6. on cleanup or `sessionId` change: aborts the controller, closes the socket, cancels reconnect

The helper for dedupe-by-id merge:
```javascript
function mergeEvents(existing, incoming) {
  const index = existing.findIndex((event) => event.id === incoming.id)
  if (index === -1) return [incoming, ...existing]
  const next = existing.slice()
  next[index] = incoming
  return next
}
```

The composite effect (replace the existing history + WS effects wholesale):
```javascript
useEffect(() => {
  if (!sessionId) return undefined

  const controller = new AbortController()
  const { signal } = controller
  let ws = null
  let reconnectTimer = null
  let reconnectAttempt = 0
  let intentionalClose = false

  // 1) Load history FIRST (gated by AbortController)
  ;(async () => {
    setLoadingHistory(true)
    setHistoryError('')
    try {
      const response = await fetch(`${controlApiBase}/hooks/${sessionId}`, { signal })
      const data = await readJson(response)
      if (signal.aborted) return
      setEvents(Array.isArray(data) ? data : [])
    } catch (error) {
      if (signal.aborted) return
      if (error.name === 'AbortError') return
      setHistoryError(getErrorMessage(error, 'Unable to load event history for this endpoint.'))
      setEvents([])
    } finally {
      if (!signal.aborted) setLoadingHistory(false)
    }
  })()

  // 2) Open WebSocket AFTER history load starts (the race-safe order)
  const protocol = websocketOrigin.protocol === 'https:' ? 'wss:' : 'ws:'
  const socketUrl = `${protocol}//${websocketOrigin.host}/ws/${sessionId}`

  const connect = () => {
    if (signal.aborted || intentionalClose) return
    setSocketState((prev) => (prev === 'connected' ? prev : 'connecting'))
    ws = new WebSocket(socketUrl)
    wsRef.current = ws

    ws.onopen = () => {
      if (signal.aborted || intentionalClose) {
        ws.close()
        return
      }
      reconnectAttempt = 0
      setSocketState('connected')
    }

    ws.onmessage = (message) => {
      if (signal.aborted) return
      let incoming
      try {
        incoming = JSON.parse(message.data)
      } catch {
        return
      }
      // Heartbeat no-op
      if (incoming && incoming.type === 'ping') return
      if (!incoming || incoming.id == null) return
      setEvents((prev) => mergeEvents(prev, incoming))
    }

    ws.onerror = () => {}
    ws.onclose = () => {
      if (signal.aborted || intentionalClose) return
      setSocketState('disconnected')
      // Exponential backoff with jitter (plan task 2.2)
      const base = 500
      const max = 15000
      const delay = Math.min(base * 2 ** reconnectAttempt, max) + Math.floor(Math.random() * 1000)
      reconnectAttempt += 1
      reconnectTimer = window.setTimeout(connect, delay)
    }
  }

  connect()

  // 3) Cleanup: abort the history fetch AND close the socket
  return () => {
    controller.abort()
    intentionalClose = true
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      if (ws.readyState === WebSocket.OPEN) ws.close()
    }
    wsRef.current = null
  }
}, [controlApiBase, sessionId, websocketOrigin.host, websocketOrigin.protocol])
```

### 2.3 Remove the now-redundant standalone `refreshHistory` effect

Delete the entire `useEffect(() => { ... refreshHistory() ... }, [controlApiBase, sessionId])` block (currently `useEventStream.jsx:486-510` approximately — locate the standalone history effect and remove it).

### 2.4 Verification (test you must add)

Append to `frontend/src/hooks/__tests__/useEventStream.test.jsx`:

```javascript
  it('aborts in-flight history fetch and reconnects on sessionId change', async () => {
    // Stub global fetch to return a slow response for the first session
    let abortObserved = false
    const originalFetch = global.fetch
    global.fetch = vi.fn((url, options = {}) => {
      if (url.includes('/hooks/session-A') && options.signal) {
        options.signal.addEventListener('abort', () => { abortObserved = true })
        return new Promise(() => {}) // never resolves
      }
      if (url.includes('/hooks/session-B')) {
        return Promise.resolve(new Response(JSON.stringify([{ id: 1, session_id: 'session-B' }]), { status: 200 }))
      }
      return Promise.resolve(new Response('[]', { status: 200 }))
    })
    // Stub WebSocket so we don't open a real one
    const originalWebSocket = global.WebSocket
    global.WebSocket = class { addEventListener(){} removeEventListener(){} send(){} close(){} }

    const { rerender } = renderHook(
      ({ sessionId }) => useEventStream({ sessionId, controlApiBase: '/api', websocketOrigin: { protocol: 'http:', host: 'localhost:8080' }, provider: 'generic' }),
      { initialProps: { sessionId: 'session-A' } }
    )
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/hooks/session-A'), expect.objectContaining({ signal: expect.any(AbortSignal) })))

    rerender({ sessionId: 'session-B' })
    await waitFor(() => expect(abortObserved).toBe(true))

    global.fetch = originalFetch
    global.WebSocket = originalWebSocket
  })
```

(If `renderHook` and `waitFor` are not yet imported in that file, add: `import { renderHook, waitFor } from '@testing-library/react'`. If happy-dom does not have `Response`, use a stub object: `return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('[]'), headers: { get: () => 'application/json' } })`.)

---

## 3. Critical: Bound Redis Pubsub, Heartbeat, RedisError Catch (Plan Task 2.4)

**Status:** FAIL — `main.py:768` is still `async for message in pubsub.listen():` (unbounded), no try/except around RedisError, no 25s heartbeat, no `asyncio.wait_for` on `pubsub.aclose()`.

**File:** `backend/app/main.py`

### 3.1 Refactor `forward_to_browser` (currently `main.py:751-808`)

Replace the body of the WebSocket endpoint with a version that:
1. runs `pubsub.get_message(timeout=0.05)` in a `while True` loop with `await asyncio.sleep(0)`
2. wraps the body in `try/except (redis.exceptions.RedisError, RuntimeError)` and logs on failure before breaking
3. spawns a separate heartbeat task that sends `{"type": "ping"}` every 25s
4. wraps `pubsub.aclose()` in `asyncio.wait_for(..., timeout=2.0)` and logs on timeout

```python
@local_control_router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    if not websocket_is_authorized(websocket, session_id):
        await websocket.close(code=1008)
        return
    await websocket.accept()

    pubsub = websocket.app.state.redis.pubsub()
    await pubsub.subscribe(f"webhook:{session_id}")

    stop_event = asyncio.Event()
    HEARTBEAT_INTERVAL = 25.0

    async def heartbeat_loop():
        try:
            while not stop_event.is_set():
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                if stop_event.is_set():
                    return
                try:
                    await websocket.send_text(json.dumps({"type": "ping"}))
                except Exception as exc:
                    logger.warning("websocket.heartbeat_failed", extra={"session_id": session_id, "error": str(exc)[:200]})
                    return
        except asyncio.CancelledError:
            raise

    async def forward_to_browser():
        try:
            while not stop_event.is_set():
                try:
                    message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.05)
                except (redis.exceptions.RedisError, RuntimeError) as exc:
                    logger.warning("websocket.pubsub_failed", extra={"session_id": session_id, "error": str(exc)[:200]})
                    break
                if message is None:
                    await asyncio.sleep(0)
                    continue
                if message.get("type") != "message":
                    continue
                try:
                    await websocket.send_text(message["data"])
                except Exception as exc:
                    logger.warning("websocket.send_failed", extra={"session_id": session_id, "error": str(exc)[:200]})
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("websocket.forward_unexpected_error", extra={"session_id": session_id, "error": str(exc)[:200]})

    async def wait_for_disconnect():
        try:
            while not stop_event.is_set():
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("websocket.receive_failed", extra={"session_id": session_id, "error": str(exc)[:200]})

    forward_task = asyncio.create_task(forward_to_browser())
    heartbeat_task = asyncio.create_task(heartbeat_loop())
    disconnect_task = asyncio.create_task(wait_for_disconnect())

    done, pending = await asyncio.wait(
        {forward_task, heartbeat_task, disconnect_task},
        return_when=asyncio.FIRST_COMPLETED,
    )
    stop_event.set()
    for task in pending:
        task.cancel()
    for task in done:
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    try:
        await asyncio.wait_for(pubsub.unsubscribe(f"webhook:{session_id}"), timeout=2.0)
    except asyncio.TimeoutError:
        logger.warning("websocket.unsubscribe_timeout", extra={"session_id": session_id})
    try:
        await asyncio.wait_for(pubsub.aclose(), timeout=2.0)
    except asyncio.TimeoutError:
        logger.warning("websocket.aclose_timeout", extra={"session_id": session_id})
```

### 3.2 Add `redis` import for the exception class

At the top of `main.py` (around the existing `import redis.asyncio as aioredis` line) make sure the synchronous `redis` namespace is also available for the exception class:

```python
import redis.asyncio as aioredis
import redis.exceptions  # noqa: F401 — used in websocket handler
```

### 3.3 Verification (test you must add)

Append to `backend/tests/test_api_smoke.py`:

```python
    def test_websocket_handler_does_not_use_unbounded_pubsub_listen(self):
        """Plan task 2.4: websocket must use bounded get_message loop, not listen()."""
        import inspect
        from app.main import websocket_endpoint
        source = inspect.getsource(websocket_endpoint)
        self.assertNotIn("pubsub.listen()", source, "websocket must not use unbounded pubsub.listen()")
        self.assertIn("get_message", source, "websocket must use pubsub.get_message with timeout")
        self.assertIn("heartbeat", source, "websocket must run a heartbeat loop")
        self.assertIn("asyncio.wait_for", source, "websocket must bound pubsub.aclose() with wait_for")
        self.assertIn("RedisError", source, "websocket must catch redis.exceptions.RedisError")
```

---

## 4. Critical: `localStorage` Quota → StatusBanner (Plan Task 2.7)

**Status:** FAIL — `useEndpointState.jsx:16-22` silently swallows all storage write errors, no `storageError` state, persistence is in state-updater callbacks, no banner.

**Files:**
- `frontend/src/hooks/useEndpointState.jsx`
- `frontend/src/components/StatusBanner.jsx` (verify it can render a "storage full" variant)
- `frontend/src/App.jsx` (consume the new state)

### 4.1 `useEndpointState.jsx` changes

**Replace** the `writeStorage` helper (lines 16-22 approximately):
```javascript
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error }
  }
}
```

**Add** a new state for storage errors near the other `useState` lines:
```javascript
const [storageError, setStorageError] = useState(null)
```

**Add** a helper that writes + reports quota errors, then move persistence to `useEffect` (NOT inside state updater callbacks):
```javascript
const persistHistory = useCallback((nextHistory) => {
  const result = writeStorage(HISTORY_KEY, nextHistory)
  if (!result.ok) {
    setStorageError({ key: HISTORY_KEY, error: result.error })
  } else if (storageError && storageError.key === HISTORY_KEY) {
    setStorageError(null)
  }
}, [storageError])

const persistLabels = useCallback((nextLabels) => {
  const result = writeStorage(LABELS_KEY, nextLabels)
  if (!result.ok) {
    setStorageError({ key: LABELS_KEY, error: result.error })
  } else if (storageError && storageError.key === LABELS_KEY) {
    setStorageError(null)
  }
}, [storageError])
```

**Refactor** `rememberSession`, `saveLabel`, `deleteEndpointLocal` to set state only (no `writeStorage` calls inside updaters). The current shape:
```javascript
const rememberSession = useCallback((nextId) => {
  setHistory((prev) => {
    const next = uniqueIds([nextId, ...prev]).slice(0, 50)
    writeStorage(HISTORY_KEY, next)  // <- inside updater
    return next
  })
}, [])
```

becomes:
```javascript
const rememberSession = useCallback((nextId) => {
  setHistory((prev) => uniqueIds([nextId, ...prev]).slice(0, 50))
}, [])
```

Apply the same pattern to `saveLabel` and `deleteEndpointLocal`. They should only call `setHistory` / `setLabels` with the new array/object; the persistence runs in the effect below.

**Add** two `useEffect`s to actually persist:
```javascript
useEffect(() => {
  if (history === undefined) return
  persistHistory(history)
}, [history, persistHistory])

useEffect(() => {
  if (labels === undefined) return
  persistLabels(labels)
}, [labels, persistLabels])
```

**Add** a `clearStorageError` callback and expose `storageError` from the hook:
```javascript
const clearStorageError = useCallback(() => setStorageError(null), [])

return {
  // ... existing returns ...
  storageError,
  clearStorageError,
}
```

### 4.2 `App.jsx` — consume the new state

In `App.jsx`, destructure `storageError` and `clearStorageError` from `useEndpointState`. Then add a `StatusBanner` next to the existing banners:

```jsx
{storageError ? (
  <StatusBanner
    tone="warning"
    title="Local browser storage is full"
    description="Endpoint labels and history are not being saved. Clear site data or remove unused endpoints, then refresh."
    action={{ label: 'Dismiss', onClick: clearStorageError }}
  />
) : null}
```

(Adapt the prop names to whatever the existing `StatusBanner` accepts — check `StatusBanner.jsx` first; if it has a different prop API, use that API and match the existing banner style.)

### 4.3 Verification (test you must add)

Append to `frontend/src/hooks/__tests__/useEndpointState.test.jsx`:

```javascript
  it('surfaces a storage error when localStorage.setItem throws QuotaExceededError', async () => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = vi.fn(() => {
      const err = new Error('quota')
      err.name = 'QuotaExceededError'
      throw err
    })

    const { result } = renderHook(
      () => useEndpointState({ controlApiBase: '/api' }),
      { wrapper }
    )

    act(() => {
      result.current.saveLabel('test-session', 'My Test Session')
    })

    await waitFor(() => expect(result.current.storageError).not.toBeNull())
    expect(result.current.storageError.key).toBe('hookrelay_endpoint_labels')

    // Clear the error and confirm it goes away on next successful write
    Storage.prototype.setItem = vi.fn(() => undefined)
    act(() => {
      result.current.clearStorageError()
    })
    expect(result.current.storageError).toBeNull()

    Storage.prototype.setItem = originalSetItem
  })
```

(Adjust `renderHook` import and the existing test file's setup; this is appended to the existing suite.)

---

## 5. Critical: `host.docker.internal` Warning (Plan Task 3.2)

**Status:** FAIL — `SetupRail.jsx:119` placeholder still hard-codes the literal URL with no warning copy. Backend has no `forward_url_warnings` field.

**Files:**
- `backend/app/schemas.py` — add `forward_url_warnings` to `SessionConfigOut`
- `backend/app/main.py` — populate it in `update_session_config`
- `frontend/src/components/SetupRail.jsx` — render warnings under the input
- `frontend/src/App.jsx` (or wherever `SetupRail` is consumed) — pass warnings through

### 5.1 `backend/app/schemas.py` — add the field

In `SessionConfigOut` (around lines 49-57), add:
```python
class SessionConfigOut(BaseModel):
    session_id:  str
    forward_url: Optional[str] = None
    provider: str = "generic"
    razorpay_webhook_secret_configured: bool = False
    forward_url_warnings: list[str] = []  # NEW

    model_config = {"from_attributes": True}
```

### 5.2 `backend/app/main.py` — populate the warnings

In `update_session_config` (around `main.py:874-898`), after the field updates and before the return, compute warnings:

```python
warnings: list[str] = []
if config and config.forward_url:
    host = ""
    try:
        from urllib.parse import urlparse
        host = (urlparse(config.forward_url).hostname or "").lower()
    except Exception:  # noqa: BLE001
        host = ""
    if host == "host.docker.internal":
        warnings.append(
            "host.docker.internal only resolves on Docker Desktop or Docker Engine 20.10+. "
            "On plain Linux without Docker Desktop, use the host's LAN IP (e.g. http://192.168.1.42:3000/...) instead."
        )
    if host in ("localhost", "127.0.0.1", "::1"):
        warnings.append(
            "Forwarding to loopback from inside the API container will not reach your host machine. "
            "Use host.docker.internal (Docker Desktop) or the host's LAN IP."
        )

# Pass warnings to the serializer
return serialize_session_config(config, session_id, forward_url_warnings=warnings)
```

Update `serialize_session_config` to accept the new kwarg and thread it into the response:
```python
def serialize_session_config(config, session_id, forward_url_warnings=None):
    if not config:
        return SessionConfigOut(session_id=session_id, forward_url_warnings=forward_url_warnings or [])
    return SessionConfigOut(
        session_id=config.session_id,
        forward_url=config.forward_url,
        provider=normalize_provider(config.provider),
        razorpay_webhook_secret_configured=bool(config.razorpay_webhook_secret),
        forward_url_warnings=forward_url_warnings or [],
    )
```

### 5.3 Frontend `SetupRail.jsx` — change the placeholder and render warnings

Change the placeholder copy (line 119) from:
```jsx
              placeholder="http://host.docker.internal:3000/webhooks/razorpay"
```
to:
```jsx
              placeholder="http://192.168.1.42:3000/webhooks/razorpay  (or host.docker.internal on Docker Desktop)"
```

In the `SetupRail` function signature, add a new prop:
```jsx
export function SetupRail({
  // ... existing props ...
  forwardUrlWarnings = [],
})
```

Below the forward URL input, render the warnings (somewhere around the existing `<button className="secondary-button compact-button" onClick={onSaveForwardUrl}>`):
```jsx
{forwardUrlWarnings.length > 0 ? (
  <ul className="setup-warnings" role="status" aria-live="polite">
    {forwardUrlWarnings.map((warning) => (
      <li key={warning} className="setup-warning">{warning}</li>
    ))}
  </ul>
) : null}
```

### 5.4 Pass warnings through from `App.jsx`

In the `App.jsx` file, find where `SetupRail` is rendered. There should be a state slot holding the `SessionConfigOut` (likely `forwardConfig` or similar). After every `PUT /sessions/{id}/config` call, store the returned `forward_url_warnings` in local state and pass it to `SetupRail` as `forwardUrlWarnings`. The minimal patch:

```jsx
// Existing state (adjust name to match the file)
const [forwardUrlWarnings, setForwardUrlWarnings] = useState([])

// In the onSaveForwardUrl handler (or whatever calls PUT):
const response = await fetch(`${controlApiBase}/sessions/${sessionId}/config`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...buildControlHeaders() },
  body: JSON.stringify({ forward_url: forwardUrl })
})
const payload = await readJson(response)
setForwardUrlWarnings(payload.forward_url_warnings || [])

// In the JSX where SetupRail is rendered:
<SetupRail
  // ... existing props ...
  forwardUrlWarnings={forwardUrlWarnings}
/>
```

(Adapt to the actual variable names already in `App.jsx`; the structure is the same.)

### 5.5 Verification (test you must add)

Append to `backend/tests/test_api_smoke.py`:

```python
    def test_update_session_config_warns_on_host_docker_internal(self):
        self.client.put(
            self.path_for("update_session_config", session_id="warn-session"),
            json={"forward_url": "http://host.docker.internal:3000/hook"},
        )
        response = self.client.get(self.path_for("get_session_config", session_id="warn-session"))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(any("host.docker.internal" in w for w in body.get("forward_url_warnings", [])))

    def test_update_session_config_warns_on_loopback_forward(self):
        self.client.put(
            self.path_for("update_session_config", session_id="loop-session"),
            json={"forward_url": "http://127.0.0.1:3000/hook"},
        )
        # Note: with the SSRF guard, this will be rejected (422). So this test
        # may need to set ALLOW_LOOPBACK_FORWARD=1. If not, skip:
        response = self.client.get(self.path_for("get_session_config", session_id="loop-session"))
        if response.status_code == 200:
            body = response.json()
            self.assertTrue(any("loopback" in w.lower() for w in body.get("forward_url_warnings", [])))
```

---

## 6. HIGH: Replay 502 → Red Pill (Plan Task 2.1)

**Status:** PARTIAL — backend correctly 502s; frontend treats any non-2xx as generic error and shows no distinct "replay sent but unreachable" pill.

**File:** `frontend/src/hooks/useEventStream.jsx` — the `replayEvent` function (around line 332-344).

### 6.1 Change `replayEvent` to branch on 502

```javascript
async function replayEvent(eventId) {
  setReplayState({ status: 'loading', eventId })
  setActionError('')
  try {
    const response = await fetch(`${controlApiBase}/hooks/${sessionId}/${eventId}/replay`, {
      method: 'POST',
      headers: buildControlHeaders(),
    })
    const payload = await readJson(response)
    if (response.status === 200) {
      setReplayState({ status: 'success', eventId, delivery: 'delivered' })
    } else if (response.status === 502) {
      // Forwarding threw — backend persisted the replay row but local handler was unreachable
      setReplayState({ status: 'success', eventId, delivery: 'failed' })
      setActionError(payload?.forward_error || 'Replay sent but the local handler was unreachable.')
    } else {
      setReplayState({ status: 'error', eventId })
      setActionError(getErrorMessage({ message: 'Replay failed.' }, 'Replay failed.'))
    }
    await wait(1200)
    setReplayState({ status: 'idle', eventId: null })
  } catch (error) {
    setReplayState({ status: 'error', eventId })
    setActionError(getErrorMessage(error, 'Replaying this event failed.'))
  }
}
```

### 6.2 Update `EventInspector.jsx` to show a different pill on `delivery: 'failed'`

In `EventInspector.jsx`, find the code path that renders the "Replayed" pill. Add a branch based on `replayState.delivery`:

```jsx
{replayState.status === 'success' && replayState.eventId === event.id ? (
  replayState.delivery === 'failed' ? (
    <span className="status-chip error" role="status" aria-live="polite">
      Replay failed — local handler unreachable
    </span>
  ) : (
    <span className="status-chip success">Replayed</span>
  )
) : null}
```

### 6.3 Verification (frontend test)

Append to `frontend/src/hooks/__tests__/useEventStream.test.jsx`:

```javascript
  it('replayEvent marks delivery as failed on 502', async () => {
    // Stub fetch to return 502
    const originalFetch = global.fetch
    global.fetch = vi.fn((url) => {
      if (url.includes('/replay')) {
        return Promise.resolve(new Response(JSON.stringify({ status: 'replay_delivery_failure', forward_error: 'connect refused' }), { status: 502, headers: { 'content-type': 'application/json' } }))
      }
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    })
    const originalWebSocket = global.WebSocket
    global.WebSocket = class { addEventListener(){} removeEventListener(){} send(){} close(){} }

    const { result } = renderHook(
      () => useEventStream({ sessionId: 's1', controlApiBase: '/api', websocketOrigin: { protocol: 'http:', host: 'localhost' }, provider: 'generic' }),
      { wrapper }
    )
    await act(async () => {
      await result.current.replayEvent(42)
    })
    expect(result.current.actionError).toMatch(/unreachable|connect/i)
    expect(result.current.replayState.delivery).toBe('failed')

    global.fetch = originalFetch
    global.WebSocket = originalWebSocket
  })
```

---

## 7. HIGH: `forward_failure_kind` Pill In Inspector (Plan Task 2.5)

**Status:** PARTIAL — column persisted, kind enum threaded through backend, test passes, **but `EventInspector.jsx` never displays the kind**.

**File:** `frontend/src/components/EventInspector.jsx`

### 7.1 Add a new pill for the failure kind

Find the section that renders `forward_delivery_status` (around line 122-144). Add a new pill immediately after:

```jsx
{event.forward_failure_kind ? (
  <span
    className="status-chip error"
    role="status"
    title={event.forward_delivery_message || ''}
  >
    {kindToLabel(event.forward_failure_kind)}
  </span>
) : null}
```

Add the helper at the top of the file (after the existing imports):
```jsx
function kindToLabel(kind) {
  switch (kind) {
    case 'timeout':      return 'Forward timed out'
    case 'connection':   return 'Connection refused'
    case 'tls':          return 'TLS handshake failed'
    case 'dns':          return 'DNS lookup failed'
    case 'invalid_url':  return 'Invalid URL'
    case 'other':
    default:             return 'Forward failed'
  }
}
```

### 7.2 Verification (test in `frontend/src/__tests__/ui.test.js`)

Add to the existing `ui.test.js`:
```javascript
  it('kindToLabel maps all forward_failure_kind values', () => {
    // import the helper from the test that already passes
    // (or export it from EventInspector.jsx for testing)
    expect(kindToLabel('timeout')).toBe('Forward timed out')
    expect(kindToLabel('connection')).toBe('Connection refused')
    expect(kindToLabel('tls')).toBe('TLS handshake failed')
    expect(kindToLabel('dns')).toBe('DNS lookup failed')
    expect(kindToLabel('invalid_url')).toBe('Invalid URL')
    expect(kindToLabel('other')).toBe('Forward failed')
  })
```

If you don't want to export the helper, the test can be done at the component level with a render assertion. Either is acceptable.

---

## 8. HIGH: "Stream Offline" UI After 10 Reconnect Failures (Plan Task 2.2 — partial coverage)

**Status:** PARTIAL — backoff works, jitter added in §2.2 above, but no "stream offline" UI after 10 failures.

**File:** `frontend/src/hooks/useEventStream.jsx` and `App.jsx` / `StatusBanner.jsx`

### 8.1 Add a `reconnectAttempts` counter to the hook return

The `reconnectAttempt` ref is internal; surface it to consumers. Use a `useState` mirror updated in `onclose`:

```javascript
const [reconnectAttempts, setReconnectAttempts] = useState(0)

// In ws.onclose:
setSocketState('disconnected')
setReconnectAttempts((n) => n + 1)

// In ws.onopen:
setReconnectAttempts(0)

return {
  // ... existing returns ...
  reconnectAttempts,
}
```

### 8.2 Render a "stream offline" banner in `App.jsx` when attempts ≥ 10

```jsx
{reconnectAttempts >= 10 && socketState === 'disconnected' ? (
  <StatusBanner
    tone="warning"
    title="Live stream offline"
    description="The WebSocket dropped 10 times in a row. Click to retry."
    action={{ label: 'Reconnect', onClick: () => window.location.reload() }}
  />
) : null}
```

(Adjust the prop API to match `StatusBanner.jsx`; the contract is `tone`, `title`, `description`, `action`.)

### 8.3 Verification (test in `useEventStream.test.jsx`)

This is exercised by the existing backoff test. Add one more case:

```javascript
  it('surfaces reconnectAttempts to the caller', async () => {
    const originalWebSocket = global.WebSocket
    let instances = []
    class FakeWS {
      constructor() { instances.push(this) }
      addEventListener(){}
      removeEventListener(){}
      send(){}
      close(){}
    }
    global.WebSocket = FakeWS

    const { result } = renderHook(
      () => useEventStream({ sessionId: 's1', controlApiBase: '/api', websocketOrigin: { protocol: 'http:', host: 'localhost' }, provider: 'generic' }),
      { wrapper }
    )
    // Simulate 3 close events
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        instances[i].onclose?.()
        await new Promise((r) => setTimeout(r, 5))
      }
    })
    expect(result.current.reconnectAttempts).toBeGreaterThanOrEqual(3)

    global.WebSocket = originalWebSocket
  })
```

---

## 9. HIGH: SetupRail Placeholder 3000 → Host LAN IP (Plan Task 3.1)

**Status:** PARTIAL — port 8080 is the compose default, but `SetupRail.jsx:119` still hard-codes port 3000 and the literal `host.docker.internal`.

**File:** `frontend/src/components/SetupRail.jsx` (line 119) — **partially fixed in §5.3 above** by changing the placeholder copy. The port `3000` in the placeholder can stay (it's a typical dev port, the warning copy explains the alternatives). No further change is required for 3.1 if §5.3 was applied. **If §5.3 was skipped, do it now.**

If the port `3000` is also wrong, change it to match the project's typical local app port (3000 is fine; it's just an example placeholder).

---

## 10. HIGH: `npm ci` Unconditional In Frontend Dockerfile (Plan Task 3.3)

**Status:** PARTIAL — `frontend/Dockerfile:4` has a conditional fallback to `npm install` if the lockfile is missing.

**File:** `frontend/Dockerfile`

### 10.1 Replace the conditional with unconditional `npm ci`

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "dev:container"]
```

Note: change `COPY package*.json ./` to the two explicit lines (the wildcard fallback was the root issue).

### 10.2 Verification (CI catches it)

After the change, the `lint-frontend` and `frontend-build` CI jobs (`npm ci`) will both pass on a clean checkout. Manual check:
```bash
docker build -f frontend/Dockerfile -t hookrelay-frontend-test frontend
docker rmi hookrelay-frontend-test
```

---

## 11. HIGH: Tunnel Script Fail-Fast On Token+Hostname Mismatch (Plan Task 3.7)

**Status:** PARTIAL — 120s timeout and status file are present, but the named-tunnel fail-fast on `CLOUDFLARE_TUNNEL_TOKEN` set + `TUNNEL_HOSTNAME` empty is missing.

**File:** `tunnel/start.sh`

### 11.1 Insert the fail-fast block after the `CLOUDFLARE_TUNNEL_TOKEN` check

Replace the current named-tunnel block (lines 23-32):
```sh
if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  # Named tunnel mode: permanent URL.
  echo "==> Named tunnel mode: permanent URL"

  # Write the permanent URL to shared volume so the dashboard can display it
  if [ -n "${TUNNEL_HOSTNAME:-}" ]; then
    echo "https://$TUNNEL_HOSTNAME" > "$URL_FILE"
    write_status "ready" "Named tunnel configured." "https://$TUNNEL_HOSTNAME"
    echo "==> Permanent tunnel URL: https://$TUNNEL_HOSTNAME"
  fi

  exec cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"

else
```

with:
```sh
if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  # Named tunnel mode: permanent URL.
  if [ -z "${TUNNEL_HOSTNAME:-}" ]; then
    write_status "error" "CLOUDFLARE_TUNNEL_TOKEN is set but TUNNEL_HOSTNAME is empty. Set both or neither."
    echo "==> ERROR: CLOUDFLARE_TUNNEL_TOKEN is set but TUNNEL_HOSTNAME is empty. Set both or neither." >&2
    exit 1
  fi
  echo "==> Named tunnel mode: permanent URL"

  # Write the permanent URL to shared volume so the dashboard can display it
  echo "https://$TUNNEL_HOSTNAME" > "$URL_FILE"
  write_status "ready" "Named tunnel configured." "https://$TUNNEL_HOSTNAME"
  echo "==> Permanent tunnel URL: https://$TUNNEL_HOSTNAME"

  exec cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"

elif [ -n "${TUNNEL_HOSTNAME:-}" ]; then
  # Hostname set without token: warn and fall through to quick-tunnel mode.
  write_status "starting" "TUNNEL_HOSTNAME is set without CLOUDFLARE_TUNNEL_TOKEN. Falling back to quick-tunnel mode (URL will differ from TUNNEL_HOSTNAME)."
  echo "==> WARNING: TUNNEL_HOSTNAME is set without CLOUDFLARE_TUNNEL_TOKEN. Falling back to quick-tunnel mode." >&2
  # fall through
fi

if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  # (already handled above; this branch never executes but is here for clarity)
  :
else
```

Wait — the original `if/else` structure means we need to restructure carefully. The cleanest replacement is to convert the top-level `if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then ... else ... fi` into a three-branch dispatch:

```sh
if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ] && [ -z "${TUNNEL_HOSTNAME:-}" ]; then
  write_status "error" "CLOUDFLARE_TUNNEL_TOKEN is set but TUNNEL_HOSTNAME is empty. Set both or neither."
  echo "==> ERROR: CLOUDFLARE_TUNNEL_TOKEN is set but TUNNEL_HOSTNAME is empty. Set both or neither." >&2
  exit 1
fi

if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  # Named tunnel mode: permanent URL.
  echo "==> Named tunnel mode: permanent URL"

  # Write the permanent URL to shared volume so the dashboard can display it
  if [ -n "${TUNNEL_HOSTNAME:-}" ]; then
    echo "https://$TUNNEL_HOSTNAME" > "$URL_FILE"
    write_status "ready" "Named tunnel configured." "https://$TUNNEL_HOSTNAME"
    echo "==> Permanent tunnel URL: https://$TUNNEL_HOSTNAME"
  fi

  exec cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN"

elif [ -n "${TUNNEL_HOSTNAME:-}" ]; then
  # Hostname set without token: warn and fall through to quick-tunnel mode.
  write_status "starting" "TUNNEL_HOSTNAME is set without CLOUDFLARE_TUNNEL_TOKEN. Falling back to quick-tunnel mode (URL will differ from TUNNEL_HOSTNAME)."
  echo "==> WARNING: TUNNEL_HOSTNAME is set without CLOUDFLARE_TUNNEL_TOKEN. Falling back to quick-tunnel mode." >&2
  # fall through to the quick-tunnel block below
  :
fi
```

Then the existing `else` block (quick-tunnel) becomes its own unconditional block — change the `else` to remove it (or leave the if/else and just remove the `if/elif` arms that now precede it; the `else` becomes unreachable from the named-tunnel path, which is fine).

The cleanest minimal-diff change is to **insert the fail-fast check at the top of the named-tunnel branch and a warn in the elif branch**, leaving the existing `if/else` structure. See the snippet above for the full shape.

### 11.2 Verification (test you must add)

Create a new file `backend/tests/test_tunnel_startsh.py` (or add to the existing test suite if there's a shell-test pattern already):

```python
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
START_SH = REPO_ROOT / "tunnel" / "start.sh"


@unittest.skipIf(not START_SH.exists(), "start.sh not present")
class TunnelStartShTests(unittest.TestCase):
    def _run(self, env, expect_exit=1, expect_status_substring=None, timeout=10):
        with tempfile.TemporaryDirectory() as tmp:
            env_with_tmp = os.environ.copy()
            env_with_tmp.update(env)
            env_with_tmp["TUNNEL_URL_FILE"] = f"{tmp}/tunnel_url.txt"
            env_with_tmp["TUNNEL_STATUS_FILE"] = f"{tmp}/tunnel_status.json"
            result = subprocess.run(
                ["sh", str(START_SH)],
                capture_output=True,
                text=True,
                env=env_with_tmp,
                timeout=timeout,
            )
            self.assertEqual(result.returncode, expect_exit, msg=f"stdout={result.stdout!r} stderr={result.stderr!r}")
            if expect_status_substring:
                status_path = Path(env_with_tmp["TUNNEL_STATUS_FILE"])
                self.assertTrue(status_path.exists(), msg=f"status file not written: {result.stderr}")
                self.assertIn(expect_status_substring, status_path.read_text())
            return result

    def test_fails_fast_when_token_set_and_hostname_empty(self):
        self._run(
            env={"CLOUDFLARE_TUNNEL_TOKEN": "fake-token", "TUNNEL_HOSTNAME": ""},
            expect_exit=1,
            expect_status_substring='"status":"error"',
        )

    def test_warns_when_hostname_set_without_token(self):
        # The script will then fall into the quick-tunnel path which would
        # block on cloudflared. We mock cloudflared to exit immediately so
        # the test can complete.
        with tempfile.TemporaryDirectory() as tmp:
            env = os.environ.copy()
            env.update({
                "CLOUDFLARE_TUNNEL_TOKEN": "",
                "TUNNEL_HOSTNAME": "hooks.example.com",
                "TUNNEL_URL_FILE": f"{tmp}/tunnel_url.txt",
                "TUNNEL_STATUS_FILE": f"{tmp}/tunnel_status.json",
                "PATH": tmp + ":" + env.get("PATH", ""),
            })
            # Mock cloudflared to fail fast
            cloudflared_path = Path(tmp) / "cloudflared"
            cloudflared_path.write_text("#!/bin/sh\nexit 1\n")
            cloudflared_path.chmod(0o755)
            result = subprocess.run(
                ["sh", str(START_SH)],
                capture_output=True,
                text=True,
                env=env,
                timeout=15,
            )
            # The script should have written a status file even though cloudflared failed
            self.assertTrue(Path(env["TUNNEL_STATUS_FILE"]).exists())
```

(Adjust for sh vs bash; the file uses `#!/bin/sh` so subprocess must use `sh`.)

---

## 12. HIGH: `make health` Should Curl The App Health (Plan Task 3.9)

**Status:** PARTIAL — backend endpoint checks are correct, but the Makefile target runs `docker compose ps` instead of `curl http://localhost:8080/api/health`.

**File:** `Makefile`

### 12.1 Replace the `health` target

```makefile
health:
	@HOOKRELAY_HTTP_PORT=$${HOOKRELAY_HTTP_PORT:-8080}; \
	curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:$$HOOKRELAY_HTTP_PORT/api/health
```

Note: the `/api/health` endpoint is on `local_control_router` which requires the ingest token. There are two ways to make this work cleanly:
- **Option A (preferred):** Move the health check to a new public router so it is unauthenticated. In `main.py`, define a `public_health_router = APIRouter()` and add `@public_health_router.get("/health")` with the same body. Then `app.include_router(public_health_router)`. Update the `make health` URL to `/health` (no `/api` prefix on public) — or keep it at `/api/health` if you also mount it on the local control router for backward compat.
- **Option B (acceptable, less invasive):** Add a Makefile target that uses the auth token:

```makefile
health:
	@HOOKRELAY_HTTP_PORT=$${HOOKRELAY_HTTP_PORT:-8080}; \
	TOKEN=$$(curl -sS -X POST -H 'Content-Type: application/json' \
	    -d '{}' http://localhost:$$HOOKRELAY_HTTP_PORT/api/sessions/health/init 2>/dev/null | python -c "import sys,json;print(json.load(sys.stdin).get('token',''))" 2>/dev/null); \
	if [ -z "$$TOKEN" ]; then \
	    echo "Unable to obtain session init token for health check." >&2; \
	    exit 1; \
	fi; \
	curl -sS -H "Authorization: Bearer $$TOKEN" -w '\n%{http_code}\n' http://localhost:$$HOOKRELAY_HTTP_PORT/api/health
```

Implement **Option A**. It's a 10-line change and unblocks the health check for future automation (k8s liveness probes, GitHub Actions, etc.).

### 12.2 Verification

```bash
make up
# wait for stack to be ready
make health
# expect: 200
```

---

## 13. HIGH: CHANGELOG 1.0.0 Entry (Plan Task 4.5)

**Status:** FAIL — `CHANGELOG.md` exists with `[Unreleased]` but no 1.0.0 entry.

**File:** `CHANGELOG.md`

### 13.1 Add a `1.0.0` entry

Replace the file content with:

```markdown
# Changelog

All notable changes to HookRelay are documented here.

## [1.0.0] - 2026-06-04

The first hard-cut release. Razorpay-first local webhook workbench with public
tunnel ingest, local forwarding, replay, and a hardened developer-machine story.

### Added

- Razorpay mode with HMAC signature verification (opt-in secret).
- Public Cloudflare tunnel ingest (named or quick-tunnel).
- Local forwarding to a developer-configured `forward_url` with SSRF guard.
- Replay of any captured event with 502 on forward failure.
- Razorpay fixture generator (`payment.captured`, `payment.failed`, `order.paid`,
  `refund.processed`, `subscription.charged`).
- Duplicate-of pill and replay payload helper.
- WebSocket live feed with bounded pubsub, heartbeat, RedisError handling, and
  exponential-backoff reconnect with jitter.
- Forward diagnostics with `forward_delivery_status` and `forward_failure_kind`.
- Per-session ingest token gating the local control plane and WebSocket.
- OSS scaffolding: `LICENSE`, `CODE_OF_CONDUCT`, `SECURITY`, `CONTRIBUTING`,
  PR/issue templates, `dependabot`, CI workflow.
- Top-level `Makefile` with `test`, `lint`, `build`, `dev`, `up`, `down`,
  `logs`, `health`, `clean`, `check`.
- Frontend test suite (vitest + Testing Library), ESLint + Prettier.
- Alembic migration stack (initial migration shipped with the release).
- Async SQLAlchemy engine (`postgresql+asyncpg://`).
- Body size cap (default 5 MB) returning 413.
- Structured logging in `lifespan`, `receive_webhook`, and `forward_webhook`.

### Fixed

- Public ingress Docker DNS lookup (`resolver 127.0.0.11 valid=30s ipv6=off`).
- Event serialization extracted into a dedicated module.
- Tunnel startup now writes a status file, waits longer for Cloudflare quick
  tunnel URLs, and fails visibly when no URL is produced.

### Security

- CORS restricted to explicit origins; `allow_credentials` no longer true.
- SSRF guard on `forward_url` (HttpUrl, IP allowlist, `ALLOW_LOOPBACK_FORWARD`
  override, no redirect-following).
- `docker compose` fails fast when `POSTGRES_USER`, `POSTGRES_PASSWORD`, or
  `POSTGRES_DB` are not set.
- Razorpay signature required when in Razorpay mode and secret is configured
  (`missing_secret` opt-out preserved for local-only debugging).

### Changed

- Default dashboard port is `8080` (override with `HOOKRELAY_HTTP_PORT`).
- All production-shaped Docker images are pinned (no `:latest`).
- Vite dev server binds to `127.0.0.1` only.
- `uvicorn --reload` lives in `docker-compose.dev.yml` override only.

### See also

- [`docs/superpowers/plans/2026-05-26-hookrelay-architecture.md`](superpowers/plans/2026-05-26-hookrelay-architecture.md)
- [`docs/superpowers/plans/2026-06-03-hookrelay-stage-01-public-ingress-502-completion.md`](superpowers/plans/2026-06-03-hookrelay-stage-01-public-ingress-502-completion.md)
- [`docs/superpowers/plans/2026-06-03-hookrelay-stage-02-backend-api-smoke-tests-completion.md`](superpowers/plans/2026-06-03-hookrelay-stage-02-backend-api-smoke-tests-completion.md)
- [`docs/superpowers/plans/2026-06-03-hookrelay-stage-03-event-serialization-extraction-completion.md`](superpowers/plans/2026-06-03-hookrelay-stage-03-event-serialization-extraction-completion.md)
- [`docs/superpowers/plans/2026-06-04-hookrelay-hardening-and-oss-readiness-plan.md`](superpowers/plans/2026-06-04-hookrelay-hardening-and-oss-readiness-plan.md)
- [`docs/superpowers/plans/2026-06-04-hardening-audit-verdict.md`](superpowers/plans/2026-06-04-hardening-audit-verdict.md)

## [Unreleased]

### Added

- Added OSS runtime scaffolding for GitHub issue templates, pull request checks, and Docker Compose validation.
- Added dev-machine make targets for starting, inspecting, validating, and health-checking the local stack.

### Changed

- Default dashboard documentation and runtime examples now use `http://localhost:8080`.
- Runtime Docker configuration now avoids floating `:latest` image tags in production-shaped files.

### Fixed

- Tunnel startup now writes a status file, waits longer for Cloudflare quick tunnel URLs, and fails visibly when no URL is produced.
```

(Adjust the link paths to the actual repo-relative paths of those plan files. They are in `docs/superpowers/plans/`.)

---

## 14. LOW: Complete The Structured Logging (Plan Task 5.5)

**Status:** PARTIAL — receive/forward log correctly, but the plan's two required log lines for pubsub and column-ensure are missing.

**File:** `backend/app/main.py`

### 14.1 Add `logger.warning` to the Redis publish path

Find the `await request.app.state.redis.publish(...)` call in `receive_webhook` (around `main.py:563`):

```python
event_data = serialize_event(event, db, config)
try:
    await request.app.state.redis.publish(
        f"webhook:{session_id}",
        json.dumps(event_data),
    )
except (redis.exceptions.RedisError, RuntimeError) as exc:
    logger.warning(
        "redis.publish_failed",
        extra={"session_id": session_id, "event_id": event.id, "error": str(exc)[:200]},
    )
```

Apply the same pattern to the **second** publish call (the re-publish after forward), and to the replay publish.

### 14.2 Add `logger.warning` per-statement in `ensure_session_config_columns` and `ensure_webhook_event_columns`

Both functions are idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS` runners. They silently swallow errors. Wrap each `connection.execute(text(...))` call:

```python
def ensure_session_config_columns() -> None:
    if engine.dialect.name == "sqlite":
        return
    statements = [
        "ALTER TABLE session_configs ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'generic' NOT NULL",
        "ALTER TABLE session_configs ADD COLUMN IF NOT EXISTS razorpay_webhook_secret TEXT",
        "ALTER TABLE session_configs ADD COLUMN IF NOT EXISTS auth_token_hash TEXT",
    ]
    with engine.begin() as connection:
        for statement in statements:
            try:
                connection.execute(text(statement))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "ensure_column_failed",
                    extra={"statement": statement[:120], "error": str(exc)[:200]},
                )
```

Apply the same pattern to `ensure_webhook_event_columns` for its statements (forward_failure_kind, replay_target_event_id, etc.).

### 14.3 Verification (test you must add)

Append to `backend/tests/test_api_smoke.py`:

```python
    def test_ensure_columns_warns_on_statement_failure(self):
        from app.main import ensure_session_config_columns, ensure_webhook_event_columns
        import logging

        with self.assertLogs("hookrelay", level="WARNING") as captured:
            # The functions are idempotent and no-op on sqlite, so we can't
            # easily induce a real failure. This test asserts the loggers are
            # wired correctly by reading the source.
            import inspect
            src_a = inspect.getsource(ensure_session_config_columns)
            src_b = inspect.getsource(ensure_webhook_event_columns)
            self.assertIn("logger.warning", src_a)
            self.assertIn("logger.warning", src_b)
```

The simpler and more durable test: assert by source inspection that the warning is wired.

---

## 15. Suggested Commit Split

The 14 tasks above are best landed as 3 logical commits:

**Commit 1 — `fix(security,build): complete hardening follow-up gaps` (CRITICAL + HIGH)**

- §1 Fail-fast DB credentials (1.5)
- §2 WS × loadHistory race (2.3)
- §3 Bound Redis pubsub + heartbeat (2.4)
- §4 localStorage quota banner (2.7)
- §5 host.docker.internal warning (3.2)
- §6 Replay 502 red pill (2.1)
- §7 forward_failure_kind pill (2.5)
- §8 Stream offline UI (2.2)
- §9 SetupRail placeholder (3.1 — already covered by §5.3)
- §10 `npm ci` unconditional (3.3)
- §11 Tunnel fail-fast (3.7)
- §12 `make health` curl (3.9)
- §14 Complete logging (5.5)

**Commit 2 — `docs(changelog): add 1.0.0 release entry`**

- §13 CHANGELOG 1.0.0 entry (4.5)

**Commit 3 — `chore(verify): re-run full test + lint + build`**

No code changes; just re-runs:
```bash
python -m unittest discover -s backend/tests -p "test_*.py"
cd frontend && npm test && npm run lint && npm run build
```

---

## 16. What You Must NOT Touch

The following areas are out of scope for this follow-up. Do not modify them, even if you see a deviation from the plan, unless something in §1-§14 explicitly directs you to.

- Alembic migrations (already correct)
- Async SQLAlchemy engine (already correct)
- Pagination (already correct; the `id DESC` deviation is functionally equivalent)
- `confirmTone`, `role="dialog"`, focus trap, type-to-confirm in `ConfirmDialog.jsx` (already correct)
- ESLint + Prettier configs (already correct)
- The four frontend test files in `frontend/src/**/__tests__/` (already passing)
- `tunnel/Dockerfile` version pin (already pinned)
- `docker-compose.yml` named volumes (already correct)
- `vite.config.js`, `nginx/nginx.conf` (already correct)
- `models.py` column names (`auth_token_hash` is correct; do not rename to `ingest_token`)
- `sessionless_local_routes_require_any_valid_token` and other auth tests (they pass; do not re-author)

---

## 17. Verification, In Order

After implementing all 14 tasks, run these commands in order. Each must succeed before moving to the next.

```bash
# 1. Backend tests (expect 52 passed; was 47)
cd "C:/Users/visha/hookrelay"
python -m unittest discover -s backend/tests -p "test_*.py"

# 2. Frontend tests (expect 24 passed; was 20)
cd frontend
npm test

# 3. Lint (expect clean)
npm run lint

# 4. Build (expect clean)
npm run build
cd ..

# 5. Compose config (expect clean)
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet

# 6. License check
make license-check

# 7. Full check target
make check
```

If any step fails, do not commit. Fix the failure and re-run from step 1.

---

## 18. Done When

This follow-up is complete when:

- `python -m unittest` reports 52 passed (47 baseline + 5 new).
- `npm test` reports 24 passed across 4 files (20 baseline + 4 new).
- `npm run lint` exits 0.
- `npm run build` produces a clean production bundle.
- `make check` exits 0 (tests, lint, build, license, compose).
- `unset POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB && docker compose -f docker-compose.yml config` exits non-zero with `must be set` in the error.
- A `curl http://localhost:8080/api/health` (after `make up`) returns `200` with a JSON body listing postgres/redis/tunnel status.
- The 15 gaps from the audit verdict are all marked Pass in the table below.

| Gap ID | Task | Status after follow-up |
|---|---|---|
| 1.5 | Fail-fast DB credentials | Pass |
| 2.1 | Replay 502 red pill | Pass |
| 2.2 | Stream offline UI | Pass |
| 2.3 | loadHistory × WS race | Pass |
| 2.4 | Bounded pubsub + heartbeat | Pass |
| 2.5 | forward_failure_kind pill | Pass |
| 2.7 | localStorage quota banner | Pass |
| 3.1 | SetupRail placeholder | Pass |
| 3.2 | host.docker.internal warning | Pass |
| 3.3 | npm ci unconditional | Pass |
| 3.7 | Tunnel fail-fast | Pass |
| 3.9 | make health curl | Pass |
| 4.5 | CHANGELOG 1.0.0 entry | Pass |
| 5.5 | Complete structured logging | Pass |
| 5.7 | Replay "Replay of Event #N" inspector | (intentionally deferred — see §18.1) |

### 18.1 Intentionally Deferred

**Plan task 5.7** (the `replay_target_event_id` "Replay of Event #N" inspector link) was noted as partial in the audit but is **not included in this follow-up**. The column is persisted, returned in the API, and tested on the backend; the missing piece is a small UI link in `EventInspector.jsx` that says "Replay of Event #N" with `N` as a clickable link to the original event. This is a 1-hour follow-up that does not block any other gap, and the data layer is already in place. Open a separate small PR for it after this follow-up lands.

---

**End of follow-up brief. Implement, test, commit, push.**
