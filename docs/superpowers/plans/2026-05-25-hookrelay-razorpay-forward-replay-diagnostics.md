# Razorpay Forward And Replay Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make forwarding and replay results clear enough for a Razorpay developer to know whether Razorpay would treat the delivery as successful, retryable, or failed before reaching the local handler.

**Architecture:** Keep forwarding storage unchanged. Add a small pure diagnostics helper that classifies existing `forward_status`, `forward_response`, and `forward_error` fields at serialization time. Reuse the existing replay flow, but extract the replay payload preparation into a pure helper so we can prove replay keeps the original body, headers, and query params.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, React, Vite, Python `unittest`.

---

## Chronological Position

This is roadmap Phase 6: **Forward And Replay Diagnostics**.

Already finished before this plan:

- [x] Phase 1: Cleanup
- [x] Phase 2: Razorpay endpoint config
- [x] Phase 3: Razorpay signature diagnostics
- [x] Phase 4: Razorpay metadata extraction
- [x] Phase 5: Duplicate detection

Do not start Phase 7 fixtures or Phase 8 go-live checklist in this implementation.

## Current State

`backend/app/main.py` already records forwarding data on each event:

- `forward_status`
- `forward_response`
- `forward_error`
- `forwarded_at`

`frontend/src/components/EventInspector.jsx` already has a `Forward Result` tab, but it still behaves like a raw field viewer. It does not clearly say:

- non-2xx response means retry risk
- connection failure or timeout means delivery failure
- replay used the original event body and headers

`frontend/src/ui.js` already has `getForwardBadge(event)`, but it classifies 4xx as client error and 5xx as server error. For Razorpay webhook debugging, both are retry risk because Razorpay expects a 2xx response.

## File Map

- Create: `backend/app/forwarding_diagnostics.py`
  - Pure helpers for forward result classification and replay payload extraction.
  - No database access.
  - No HTTP calls.

- Create: `backend/tests/test_forwarding_diagnostics.py`
  - Unit tests for delivery success, retry risk, delivery failure, not forwarded, and replay payload preservation.

- Modify: `backend/app/main.py`
  - Import the helper functions.
  - Add forward diagnostics to `serialize_event()`.
  - Use the replay payload helper inside `replay_event()`.

- Modify: `backend/app/schemas.py`
  - Add response fields for the derived diagnostics.

- Modify: `frontend/src/ui.js`
  - Update `getForwardBadge(event)` to prefer the new derived diagnostic status.

- Modify: `frontend/src/components/EventInspector.jsx`
  - Show forward diagnostic message in the Forward Result tab.
  - Show a replay payload note for replay events.

## Success Criteria

- [ ] Forwarded 2xx events show `success`.
- [ ] Forwarded non-2xx events show `retry_risk`.
- [ ] Timeout or connection failure events show `delivery_failure`.
- [ ] Events with no forwarding attempt show `not_forwarded`.
- [ ] Replay uses the original body, headers, and query params.
- [ ] Replay events are visibly labeled as replay deliveries in the Forward Result tab.
- [ ] No database migration is added.
- [ ] Generic webhook behavior still works.

## Task 1: Add Pure Forward Diagnostics Helper

**Files:**

- Create: `backend/app/forwarding_diagnostics.py`
- Create: `backend/tests/test_forwarding_diagnostics.py`

- [ ] **Step 1: Create the failing tests**

Create `backend/tests/test_forwarding_diagnostics.py`:

```python
import unittest
from types import SimpleNamespace

from backend.app.forwarding_diagnostics import (
    build_forward_diagnostics,
    build_replay_forward_payload,
)


class ForwardingDiagnosticsTests(unittest.TestCase):
    def test_2xx_status_is_success(self):
        event = SimpleNamespace(forward_status=200, forward_error=None)

        diagnostics = build_forward_diagnostics(event)

        self.assertEqual(diagnostics["forward_delivery_status"], "success")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "Local handler returned 2xx. Razorpay should treat this delivery as successful.",
        )

    def test_non_2xx_status_is_retry_risk(self):
        event = SimpleNamespace(forward_status=500, forward_error=None)

        diagnostics = build_forward_diagnostics(event)

        self.assertEqual(diagnostics["forward_delivery_status"], "retry_risk")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "Local handler returned non-2xx. Razorpay may retry this webhook.",
        )

    def test_forward_error_is_delivery_failure(self):
        event = SimpleNamespace(forward_status=None, forward_error="ConnectError")

        diagnostics = build_forward_diagnostics(event)

        self.assertEqual(diagnostics["forward_delivery_status"], "delivery_failure")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "HookRelay could not deliver the webhook to the local handler.",
        )

    def test_missing_forward_status_is_not_forwarded(self):
        event = SimpleNamespace(forward_status=None, forward_error=None)

        diagnostics = build_forward_diagnostics(event)

        self.assertEqual(diagnostics["forward_delivery_status"], "not_forwarded")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "No forwarding attempt is recorded for this event.",
        )

    def test_replay_payload_uses_original_body_headers_and_query_params(self):
        event = SimpleNamespace(
            body='{"event":"payment.captured"}',
            headers={"X-Razorpay-Event-Id": "evt_replay"},
            query_params={"source": "manual"},
        )

        body, headers, query_params = build_replay_forward_payload(event)

        self.assertEqual(body, b'{"event":"payment.captured"}')
        self.assertEqual(headers, {"X-Razorpay-Event-Id": "evt_replay"})
        self.assertEqual(query_params, {"source": "manual"})

    def test_replay_payload_ignores_non_dict_headers_and_query_params(self):
        event = SimpleNamespace(body=None, headers=[], query_params="bad")

        body, headers, query_params = build_replay_forward_payload(event)

        self.assertEqual(body, b"")
        self.assertIsNone(headers)
        self.assertIsNone(query_params)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```powershell
python -m unittest backend.tests.test_forwarding_diagnostics
```

Expected:

```text
ModuleNotFoundError: No module named 'backend.app.forwarding_diagnostics'
```

- [ ] **Step 3: Add the minimal helper implementation**

Create `backend/app/forwarding_diagnostics.py`:

```python
def build_forward_diagnostics(event) -> dict:
    forward_error = getattr(event, "forward_error", None)
    forward_status = getattr(event, "forward_status", None)

    if forward_error:
        return {
            "forward_delivery_status": "delivery_failure",
            "forward_delivery_message": "HookRelay could not deliver the webhook to the local handler.",
        }

    if forward_status is None:
        return {
            "forward_delivery_status": "not_forwarded",
            "forward_delivery_message": "No forwarding attempt is recorded for this event.",
        }

    if 200 <= forward_status < 300:
        return {
            "forward_delivery_status": "success",
            "forward_delivery_message": "Local handler returned 2xx. Razorpay should treat this delivery as successful.",
        }

    return {
        "forward_delivery_status": "retry_risk",
        "forward_delivery_message": "Local handler returned non-2xx. Razorpay may retry this webhook.",
    }


def build_replay_forward_payload(event) -> tuple[bytes, dict | None, dict | None]:
    body = getattr(event, "body", None)
    headers = getattr(event, "headers", None)
    query_params = getattr(event, "query_params", None)

    return (
        body.encode("utf-8") if body else b"",
        headers if isinstance(headers, dict) else None,
        query_params if isinstance(query_params, dict) else None,
    )
```

- [ ] **Step 4: Run the focused helper tests**

Run:

```powershell
python -m unittest backend.tests.test_forwarding_diagnostics
```

Expected:

```text
Ran 6 tests
OK
```

## Task 2: Expose Forward Diagnostics In Event Serialization

**Files:**

- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: Add response fields to the schema**

In `backend/app/schemas.py`, add these fields to `WebhookEventOut` after `forwarded_at`:

```python
    forward_delivery_status: str = "not_forwarded"
    forward_delivery_message: Optional[str] = None
```

- [ ] **Step 2: Import the helper in `main.py`**

In `backend/app/main.py`, add this import near the existing local imports:

```python
from .forwarding_diagnostics import build_forward_diagnostics, build_replay_forward_payload
```

- [ ] **Step 3: Add diagnostics inside `serialize_event()`**

Change `serialize_event()` from:

```python
    data = WebhookEventOut.model_validate(event).model_dump()
    data.update(build_razorpay_diagnostics(event, config, db))
    return jsonable_encoder(data)
```

To:

```python
    data = WebhookEventOut.model_validate(event).model_dump()
    data.update(build_forward_diagnostics(event))
    data.update(build_razorpay_diagnostics(event, config, db))
    return jsonable_encoder(data)
```

- [ ] **Step 4: Use the replay payload helper**

In `replay_event()`, replace:

```python
    raw_body = original.body.encode("utf-8") if original.body else b""
    status, response, error = await forward_webhook(
        config.forward_url,
        raw_body,
        headers=original.headers if isinstance(original.headers, dict) else None,
        query_params=original.query_params if isinstance(original.query_params, dict) else None,
    )
```

With:

```python
    raw_body, replay_headers, replay_query_params = build_replay_forward_payload(original)
    status, response, error = await forward_webhook(
        config.forward_url,
        raw_body,
        headers=replay_headers,
        query_params=replay_query_params,
    )
```

- [ ] **Step 5: Run backend verification**

Run:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
python -m py_compile backend/app/main.py backend/app/forwarding_diagnostics.py
```

Expected:

- all backend tests pass
- compile exits with code `0`

## Task 3: Update Forward Badge Classification

**Files:**

- Modify: `frontend/src/ui.js`

- [ ] **Step 1: Update `getForwardBadge(event)`**

Replace the full `getForwardBadge(event)` function in `frontend/src/ui.js` with:

```javascript
export function getForwardBadge(event) {
  switch (event?.forward_delivery_status) {
    case 'success':
      return { tone: 'success', label: 'Delivered' }
    case 'retry_risk':
      return { tone: 'warning', label: 'Retry risk' }
    case 'delivery_failure':
      return { tone: 'error', label: 'Delivery failure' }
    case 'not_forwarded':
      return { tone: 'info', label: 'Not forwarded' }
    default:
      break
  }

  if (event?.forward_error) {
    return { tone: 'error', label: 'Delivery failure' }
  }
  if (event?.forward_status == null) {
    return { tone: 'info', label: 'Not forwarded' }
  }
  if (event.forward_status >= 200 && event.forward_status < 300) {
    return { tone: 'success', label: 'Delivered' }
  }
  return { tone: 'warning', label: 'Retry risk' }
}
```

- [ ] **Step 2: Run frontend build**

Run:

```powershell
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Expected: Vite build succeeds.

Remove only the generated `.vite-build-tmp` folder after verification.

## Task 4: Show Actionable Forward And Replay Diagnostics In The Inspector

**Files:**

- Modify: `frontend/src/components/EventInspector.jsx`

- [ ] **Step 1: Add local display constants**

Inside `EventInspector`, after `duplicateMessage`, add:

```jsx
  const forwardBadge = getForwardBadge(event)
  const forwardMessage = event?.forward_delivery_message || 'No forwarding diagnostics recorded for this event.'
  const replayMessage = event?.method === 'REPLAY'
    ? 'Replay sent the stored body, headers, and query params from the original event.'
    : null
```

- [ ] **Step 2: Replace duplicate `getForwardBadge(event)` calls in the Forward Result tab**

Replace:

```jsx
                  <span className={`pill ${getForwardBadge(event).tone}`}>{getForwardBadge(event).label}</span>
                  {event.forwarded_at ? <span className="pill">Forwarded {formatDateTime(event.forwarded_at)}</span> : null}
```

With:

```jsx
                  <span className={`pill ${forwardBadge.tone}`}>{forwardBadge.label}</span>
                  <span className={`pill ${forwardBadge.tone}`}>{forwardMessage}</span>
                  {event.forwarded_at ? <span className="pill">Forwarded {formatDateTime(event.forwarded_at)}</span> : null}
                  {replayMessage ? <span className="pill warning">{replayMessage}</span> : null}
```

- [ ] **Step 3: Add diagnostic status to the Forward Result metadata grid**

Inside the `meta-grid` for the Forward Result tab, after the `Forward status` pill, add:

```jsx
                  <div className="meta-pill">
                    <span className="meta-label">Delivery result</span>
                    <span className="meta-value">{event.forward_delivery_status || 'not_forwarded'}</span>
                  </div>
```

- [ ] **Step 4: Run frontend build**

Run:

```powershell
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Expected: Vite build succeeds.

Remove only the generated `.vite-build-tmp` folder after verification.

## Task 5: Manual Forward And Replay Checks

**Files:**

- No file changes.

- [ ] **Step 1: Start the stack**

Run:

```powershell
docker compose up --build
```

Expected: local ingress is reachable at `http://localhost`.

- [ ] **Step 2: Configure a test endpoint**

Set endpoint `forward-diagnostics` to Razorpay mode and set its forward URL to a reachable local handler that returns HTTP `200`.

Expected: config save succeeds and the UI still shows Razorpay mode.

- [ ] **Step 3: Send a webhook to the 200 handler**

Send:

```powershell
curl -X POST http://localhost/api/hooks/forward-diagnostics `
  -H "Content-Type: application/json" `
  -H "X-Razorpay-Event-Id: evt_forward_success" `
  -d "{\"event\":\"payment.captured\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_forward_success\"}}}}"
```

Expected:

- event is captured
- Forward Result tab shows `Delivered`
- delivery result is `success`
- response body is visible if the handler returned one

- [ ] **Step 4: Configure the same endpoint to a handler that returns HTTP `500`**

Send another webhook with `X-Razorpay-Event-Id: evt_forward_retry`.

Expected:

- event is captured
- Forward Result tab shows `Retry risk`
- delivery result is `retry_risk`
- response body is visible

- [ ] **Step 5: Configure the same endpoint to an unavailable local handler**

Use a URL with no listener, such as:

```text
http://host.docker.internal:59999/webhook
```

Send another webhook with `X-Razorpay-Event-Id: evt_forward_failure`.

Expected:

- event is captured
- Forward Result tab shows `Delivery failure`
- delivery result is `delivery_failure`
- forward error is visible

- [ ] **Step 6: Replay the first event**

Replay the first captured event from the UI.

Expected:

- replay creates a new `REPLAY` event
- Forward Result tab shows the replay note
- Meta tab duplicate check still labels it as a replay duplicate test when the original had `X-Razorpay-Event-Id`

## Final Verification

Run:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
python -m py_compile backend/app/main.py backend/app/forwarding_diagnostics.py
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
git diff --check
```

Expected:

- backend tests pass
- Python compile passes
- frontend build passes
- `git diff --check` has no output
- `.vite-build-tmp` is deleted after build verification

## Karpathy Constraints

- [ ] Do not store derived forward diagnostics in the database.
- [ ] Do not change the forwarding transport unless a verification exposes a bug.
- [ ] Do not add a retry engine.
- [ ] Do not add fixture generation.
- [ ] Do not add provider abstractions.
- [ ] Do not rewrite the inspector layout.
- [ ] Every changed line must trace to Phase 6.

## Not In This Phase

- [ ] Razorpay test fixtures.
- [ ] Go-live checklist.
- [ ] Cloud tunnel URL automation.
- [ ] Razorpay dashboard API updates.
- [ ] Background retry queue.
- [ ] Multi-provider framework.
