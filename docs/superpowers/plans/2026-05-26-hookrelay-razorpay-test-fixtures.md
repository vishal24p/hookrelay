# Razorpay Test Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer choose a Razorpay-like local fixture, send it through the existing capture route, and get the same signature, metadata, duplicate, forward, and replay diagnostics as a real Razorpay webhook.

**Architecture:** Generate Razorpay fixture requests on the backend so the saved webhook secret never leaves the API. The frontend asks the backend for a prepared fixture request, then posts that exact body string and headers to the existing `/hooks/{session_id}` capture path. The frontend must not parse and re-stringify the prepared body, because the signature is computed over the exact bytes represented by that string. Fixture status is derived from captured headers during serialization; no database migration is needed.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, React, Vite, Python `unittest`.

---

## Chronological Position

This is roadmap Phase 7: **Razorpay Test Fixtures**.

Already finished before this plan:

- [x] Phase 1: Cleanup
- [x] Phase 2: Razorpay endpoint config
- [x] Phase 3: Razorpay signature diagnostics
- [x] Phase 4: Razorpay metadata extraction
- [x] Phase 5: Duplicate detection
- [x] Phase 6: Forward and replay diagnostics

Do not start Phase 8 go-live checklist in this implementation.

## Current State

`frontend/src/hooks/useEventStream.jsx` currently creates one Razorpay test event in the browser when provider mode is `razorpay`. Treat this as partial existing work to replace, not as a new feature from zero. It is not enough for Phase 7 because:

- it only covers `payment.captured`
- it cannot generate `X-Razorpay-Signature` from the stored secret
- the UI cannot choose a fixture
- events are marked with `X-HookRelay-Fixture`, but the serialized event schema does not expose a fixture label

The backend already has the pieces fixtures should reuse:

- `receive_webhook()` captures through `/hooks/{session_id}`
- `verify_razorpay_signature()` verifies signatures from the exact stored body string
- `extract_razorpay_metadata()` extracts event type and common Razorpay IDs
- `serialize_event()` adds diagnostics without storing derived fields

The fixture endpoint in this plan prepares a signed request but does not insert a `WebhookEvent` directly. The second frontend request to `/hooks/{session_id}` is intentional: it proves fixtures use the same capture, publish, forward, WebSocket, and replay path as real inbound webhooks. The signed body must be sent unchanged.

## File Map

- Create: `backend/app/razorpay_fixtures.py`
  - Fixture catalog.
  - Fixture body builders.
  - Exact body JSON string generation.
  - Optional signature generation from the saved secret.
  - Captured event fixture-label diagnostics from headers.

- Create: `backend/tests/test_razorpay_fixtures.py`
  - Unit tests for required fixture keys, signature generation, missing secret behavior, unknown fixture rejection, and captured fixture label diagnostics.

- Modify: `backend/app/main.py`
  - Import fixture helpers.
  - Add fixture diagnostics to `serialize_event()`.
  - Add a local-control endpoint that prepares a fixture request without inserting an event directly.

- Modify: `backend/app/schemas.py`
  - Add fixture diagnostic fields to `WebhookEventOut`.
  - Add response model for prepared fixture requests.

- Modify: `frontend/src/ui.js`
  - Add the fixture option list used by the setup UI.

- Modify: `frontend/src/hooks/useEventStream.jsx`
  - Replace browser-side Razorpay payload generation with backend-prepared fixture requests.
  - Keep the existing generic local test behavior.

- Modify: `frontend/src/App.jsx`
  - Hold selected fixture key.
  - Pass selected fixture state to `SetupRail`.

- Modify: `frontend/src/components/SetupRail.jsx`
  - Add a fixture picker in Razorpay mode.
  - Send the selected fixture through the existing test button.

- Modify: `frontend/src/components/EventList.jsx`
  - Show a `Local fixture` pill when a captured event came from a fixture.

- Modify: `frontend/src/components/EventInspector.jsx`
  - Show fixture source and fixture key in the Meta tab.

## Success Criteria

- [ ] Fixtures exist for `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, and `subscription.charged`.
- [ ] Fixture events are labeled as local fixtures in the event list.
- [ ] Fixture metadata appears in the inspector.
- [ ] Fixture body shape is Razorpay-like and works with existing metadata extraction.
- [ ] Fixture signatures are generated when a Razorpay webhook secret is configured.
- [ ] Fixture signatures verify as `valid` when provider mode is Razorpay and the secret is configured.
- [ ] Fixture signatures are omitted when no secret is configured.
- [ ] UI lets the user choose a fixture and send it through the existing `/hooks/{session_id}` capture path.
- [ ] Fixture events can be forwarded and replayed.
- [ ] No database migration is added.

## Task 1: Add Backend Fixture Builder

**Files:**

- Create: `backend/app/razorpay_fixtures.py`
- Create: `backend/tests/test_razorpay_fixtures.py`

- [ ] **Step 1: Write fixture builder tests first**

Create `backend/tests/test_razorpay_fixtures.py`:

```python
import hashlib
import hmac
import json
import unittest
from types import SimpleNamespace

from backend.app.razorpay_fixtures import (
    RAZORPAY_FIXTURE_KEYS,
    build_fixture_event_diagnostics,
    build_razorpay_fixture_request,
)


class RazorpayFixtureTests(unittest.TestCase):
    def test_catalog_has_required_fixture_keys(self):
        self.assertEqual(
            RAZORPAY_FIXTURE_KEYS,
            [
                "payment_captured",
                "payment_failed",
                "order_paid",
                "refund_processed",
                "subscription_charged",
            ],
        )

    def test_payment_captured_fixture_has_razorpay_shape(self):
        fixture = build_razorpay_fixture_request(
            "payment_captured",
            secret=None,
            suffix="fixed",
            created_at=1700000000,
        )

        body = json.loads(fixture["body"])

        self.assertEqual(body["entity"], "event")
        self.assertEqual(body["event"], "payment.captured")
        self.assertEqual(body["contains"], ["payment"])
        self.assertEqual(body["payload"]["payment"]["entity"]["id"], "pay_fixed")
        self.assertEqual(fixture["headers"]["X-Razorpay-Event-Id"], "evt_fixed")
        self.assertEqual(fixture["headers"]["X-HookRelay-Fixture"], "razorpay-local")
        self.assertEqual(fixture["headers"]["X-HookRelay-Fixture-Key"], "payment_captured")

    def test_all_fixtures_produce_expected_event_types(self):
        expected = {
            "payment_captured": "payment.captured",
            "payment_failed": "payment.failed",
            "order_paid": "order.paid",
            "refund_processed": "refund.processed",
            "subscription_charged": "subscription.charged",
        }

        for fixture_key, event_type in expected.items():
            with self.subTest(fixture_key=fixture_key):
                fixture = build_razorpay_fixture_request(
                    fixture_key,
                    secret=None,
                    suffix="fixed",
                    created_at=1700000000,
                )
                body = json.loads(fixture["body"])

                self.assertEqual(body["event"], event_type)

    def test_secret_generates_signature_from_exact_body(self):
        fixture = build_razorpay_fixture_request(
            "order_paid",
            secret="whsec_test",
            suffix="fixed",
            created_at=1700000000,
        )

        expected_signature = hmac.new(
            b"whsec_test",
            fixture["body"].encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        self.assertEqual(fixture["headers"]["X-Razorpay-Signature"], expected_signature)
        self.assertTrue(fixture["signature_generated"])

    def test_without_secret_omits_signature(self):
        fixture = build_razorpay_fixture_request(
            "refund_processed",
            secret=None,
            suffix="fixed",
            created_at=1700000000,
        )

        self.assertNotIn("X-Razorpay-Signature", fixture["headers"])
        self.assertFalse(fixture["signature_generated"])

    def test_unknown_fixture_key_raises_value_error(self):
        with self.assertRaises(ValueError):
            build_razorpay_fixture_request(
                "unknown",
                secret=None,
                suffix="fixed",
                created_at=1700000000,
            )

    def test_fixture_event_diagnostics_reads_headers_case_insensitively(self):
        event = SimpleNamespace(
            headers={
                "x-hookrelay-fixture": "razorpay-local",
                "X-HookRelay-Fixture-Key": "payment_failed",
            }
        )

        diagnostics = build_fixture_event_diagnostics(event)

        self.assertTrue(diagnostics["is_local_fixture"])
        self.assertEqual(diagnostics["fixture_source"], "razorpay-local")
        self.assertEqual(diagnostics["fixture_key"], "payment_failed")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the new tests and confirm they fail for the missing module**

Run:

```powershell
python -m unittest backend.tests.test_razorpay_fixtures
```

Expected:

```text
ModuleNotFoundError: No module named 'backend.app.razorpay_fixtures'
```

- [ ] **Step 3: Add the fixture builder**

Create `backend/app/razorpay_fixtures.py`:

```python
import hashlib
import hmac
import json
import time
import uuid
from copy import deepcopy


RAZORPAY_FIXTURE_KEYS = [
    "payment_captured",
    "payment_failed",
    "order_paid",
    "refund_processed",
    "subscription_charged",
]

FIXTURE_LABELS = {
    "payment_captured": "Payment captured",
    "payment_failed": "Payment failed",
    "order_paid": "Order paid",
    "refund_processed": "Refund processed",
    "subscription_charged": "Subscription charged",
}


def _header_value(headers: dict | None, name: str) -> str | None:
    if not headers:
        return None
    expected = name.lower()
    for key, value in headers.items():
        if str(key).lower() == expected:
            return str(value)
    return None


def _ids(suffix: str) -> dict:
    return {
        "account": f"acc_{suffix}",
        "event": f"evt_{suffix}",
        "payment": f"pay_{suffix}",
        "order": f"order_{suffix}",
        "refund": f"rfnd_{suffix}",
        "subscription": f"sub_{suffix}",
    }


def _payment_entity(ids: dict, created_at: int, status: str, captured: bool) -> dict:
    return {
        "id": ids["payment"],
        "entity": "payment",
        "amount": 50000,
        "currency": "INR",
        "status": status,
        "order_id": ids["order"],
        "invoice_id": None,
        "international": False,
        "method": "card",
        "amount_refunded": 0,
        "refund_status": None,
        "captured": captured,
        "description": "HookRelay local fixture payment",
        "card_id": "card_fixture",
        "bank": None,
        "wallet": None,
        "vpa": None,
        "email": "dev@example.com",
        "contact": "+919999999999",
        "notes": {"source": "hookrelay_fixture"},
        "fee": None,
        "tax": None,
        "error_code": None if captured else "BAD_REQUEST_ERROR",
        "error_description": None if captured else "Payment failed in local fixture",
        "created_at": created_at,
    }


def _order_entity(ids: dict, created_at: int, status: str = "paid") -> dict:
    return {
        "id": ids["order"],
        "entity": "order",
        "amount": 50000,
        "amount_paid": 50000 if status == "paid" else 0,
        "amount_due": 0 if status == "paid" else 50000,
        "currency": "INR",
        "receipt": "hookrelay_fixture_receipt",
        "offer_id": None,
        "status": status,
        "attempts": 1,
        "notes": {"source": "hookrelay_fixture"},
        "created_at": created_at,
    }


def _refund_entity(ids: dict, created_at: int) -> dict:
    return {
        "id": ids["refund"],
        "entity": "refund",
        "amount": 50000,
        "currency": "INR",
        "payment_id": ids["payment"],
        "notes": {"source": "hookrelay_fixture"},
        "receipt": "hookrelay_fixture_refund",
        "status": "processed",
        "speed_processed": "normal",
        "speed_requested": "normal",
        "created_at": created_at,
    }


def _subscription_entity(ids: dict, created_at: int) -> dict:
    return {
        "id": ids["subscription"],
        "entity": "subscription",
        "plan_id": "plan_hookrelay_fixture",
        "customer_id": "cust_hookrelay_fixture",
        "status": "active",
        "current_start": created_at,
        "current_end": created_at + 2592000,
        "ended_at": None,
        "quantity": 1,
        "notes": {"source": "hookrelay_fixture"},
        "charge_at": created_at + 2592000,
        "start_at": created_at,
        "end_at": None,
        "auth_attempts": 0,
        "total_count": 12,
        "paid_count": 1,
        "customer_notify": True,
        "created_at": created_at,
    }


def _base_event(event_type: str, contains: list[str], ids: dict, created_at: int, payload: dict) -> dict:
    return {
        "entity": "event",
        "account_id": ids["account"],
        "event": event_type,
        "contains": contains,
        "payload": payload,
        "created_at": created_at,
    }


def _fixture_body(fixture_key: str, suffix: str, created_at: int) -> dict:
    ids = _ids(suffix)
    if fixture_key == "payment_captured":
        return _base_event(
            "payment.captured",
            ["payment"],
            ids,
            created_at,
            {"payment": {"entity": _payment_entity(ids, created_at, "captured", True)}},
        )
    if fixture_key == "payment_failed":
        return _base_event(
            "payment.failed",
            ["payment"],
            ids,
            created_at,
            {"payment": {"entity": _payment_entity(ids, created_at, "failed", False)}},
        )
    if fixture_key == "order_paid":
        return _base_event(
            "order.paid",
            ["order", "payment"],
            ids,
            created_at,
            {
                "order": {"entity": _order_entity(ids, created_at)},
                "payment": {"entity": _payment_entity(ids, created_at, "captured", True)},
            },
        )
    if fixture_key == "refund_processed":
        return _base_event(
            "refund.processed",
            ["refund", "payment"],
            ids,
            created_at,
            {
                "refund": {"entity": _refund_entity(ids, created_at)},
                "payment": {"entity": _payment_entity(ids, created_at, "captured", True)},
            },
        )
    if fixture_key == "subscription_charged":
        return _base_event(
            "subscription.charged",
            ["subscription", "payment"],
            ids,
            created_at,
            {
                "subscription": {"entity": _subscription_entity(ids, created_at)},
                "payment": {
                    "entity": {
                        **_payment_entity(ids, created_at, "captured", True),
                        "subscription_id": ids["subscription"],
                    }
                },
            },
        )
    raise ValueError(f"Unknown Razorpay fixture: {fixture_key}")


def build_razorpay_fixture_request(
    fixture_key: str,
    secret: str | None,
    suffix: str | None = None,
    created_at: int | None = None,
) -> dict:
    if fixture_key not in RAZORPAY_FIXTURE_KEYS:
        raise ValueError(f"Unknown Razorpay fixture: {fixture_key}")

    suffix = suffix or uuid.uuid4().hex[:12]
    created_at = created_at or int(time.time())
    body = deepcopy(_fixture_body(fixture_key, suffix, created_at))
    body_text = json.dumps(body, separators=(",", ":"))

    headers = {
        "Content-Type": "application/json",
        "X-HookRelay-Fixture": "razorpay-local",
        "X-HookRelay-Fixture-Key": fixture_key,
        "X-Razorpay-Event-Id": f"evt_{suffix}",
    }
    if secret:
        headers["X-Razorpay-Signature"] = hmac.new(
            secret.encode("utf-8"),
            body_text.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    return {
        "fixture_key": fixture_key,
        "label": FIXTURE_LABELS[fixture_key],
        "headers": headers,
        "body": body_text,
        "signature_generated": bool(secret),
    }


def build_fixture_event_diagnostics(event) -> dict:
    source = _header_value(getattr(event, "headers", None), "x-hookrelay-fixture")
    key = _header_value(getattr(event, "headers", None), "x-hookrelay-fixture-key")
    return {
        "is_local_fixture": bool(source),
        "fixture_source": source,
        "fixture_key": key,
    }
```

- [ ] **Step 4: Run focused fixture tests**

Run:

```powershell
python -m unittest backend.tests.test_razorpay_fixtures
```

Expected:

```text
Ran 7 tests
OK
```

## Task 2: Expose Prepared Fixture Requests From The Backend

**Files:**

- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add fixture fields to `WebhookEventOut`**

In `backend/app/schemas.py`, add these fields after `duplicate_of_id`:

```python
    is_local_fixture: bool = False
    fixture_source: Optional[str] = None
    fixture_key: Optional[str] = None
```

- [ ] **Step 2: Add response model for prepared fixture requests**

In `backend/app/schemas.py`, add this class after `SessionConfigOut`:

```python
class RazorpayFixtureRequestOut(BaseModel):
    fixture_key: str
    label: str
    headers: Dict[str, Any]
    body: str
    signature_generated: bool = False
```

- [ ] **Step 3: Import fixture helpers and schema in `main.py`**

Change the schema import in `backend/app/main.py` from:

```python
from .schemas import WebhookEventOut, SessionConfigIn, SessionConfigOut
```

To:

```python
from .schemas import WebhookEventOut, SessionConfigIn, SessionConfigOut, RazorpayFixtureRequestOut
```

Add this fixture import near the existing local imports:

```python
from .razorpay_fixtures import build_fixture_event_diagnostics, build_razorpay_fixture_request
```

- [ ] **Step 4: Add fixture diagnostics during event serialization**

Change `serialize_event()` from:

```python
    data = WebhookEventOut.model_validate(event).model_dump()
    data.update(build_forward_diagnostics(event, forward_url_configured=bool(config and config.forward_url)))
    data.update(build_razorpay_diagnostics(event, config, db))
    return jsonable_encoder(data)
```

To:

```python
    data = WebhookEventOut.model_validate(event).model_dump()
    data.update(build_forward_diagnostics(event, forward_url_configured=bool(config and config.forward_url)))
    data.update(build_razorpay_diagnostics(event, config, db))
    data.update(build_fixture_event_diagnostics(event))
    return jsonable_encoder(data)
```

- [ ] **Step 5: Add endpoint for preparing fixture requests**

In `backend/app/main.py`, add this route near the session config routes:

```python
@local_control_router.post(
    "/sessions/{session_id}/razorpay-fixtures/{fixture_key}",
    response_model=RazorpayFixtureRequestOut,
)
def create_razorpay_fixture_request(
    session_id: str,
    fixture_key: str,
    db: Session = Depends(get_db),
):
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    secret = None
    if config and normalize_provider(config.provider) == PROVIDER_RAZORPAY:
        secret = config.razorpay_webhook_secret

    try:
        return build_razorpay_fixture_request(fixture_key, secret)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown Razorpay fixture")
```

This endpoint prepares an HTTP request for the frontend. It must not insert a `WebhookEvent` directly. It also must not return the Razorpay webhook secret.

- [ ] **Step 6: Run backend verification**

Run:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
python -m py_compile backend/app/main.py backend/app/razorpay_fixtures.py
```

Expected:

- all backend tests pass
- compile exits with code `0`

## Task 3: Send Backend-Prepared Razorpay Fixtures From The Frontend

**Files:**

- Modify: `frontend/src/hooks/useEventStream.jsx`

- [ ] **Step 1: Replace browser-side Razorpay fixture generation**

In `frontend/src/hooks/useEventStream.jsx`, keep `randomId()` for generic tests. Replace `buildTestWebhook(provider)` with:

```jsx
function buildGenericTestWebhook() {
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-HookRelay-Fixture': 'generic-local',
    },
    body: JSON.stringify({
      event_type: 'hookrelay.test',
      event_id: randomId('evt'),
      created_at: new Date().toISOString(),
      data: {
        message: 'Local test webhook',
      },
    }),
  }
}
```

- [ ] **Step 2: Add backend fixture preparation helper**

Inside `useEventStream()`, before `sendTestWebhook()`, add:

```jsx
  async function prepareRazorpayFixture(fixtureKey) {
    return readJson(await fetch(`${controlApiBase}/sessions/${sessionId}/razorpay-fixtures/${fixtureKey}`, {
      method: 'POST',
    }))
  }
```

- [ ] **Step 3: Update `sendTestWebhook()` to accept a fixture key**

Replace the current `sendTestWebhook()` function with:

```jsx
  async function sendTestWebhook(fixtureKey = 'payment_captured') {
    setTestState('loading')
    setActionError('')
    try {
      const testWebhook = provider === 'razorpay'
        ? await prepareRazorpayFixture(fixtureKey)
        : buildGenericTestWebhook()

      const response = await fetch(`${controlApiBase}/hooks/${sessionId}`, {
        method: 'POST',
        headers: testWebhook.headers,
        body: testWebhook.body,
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
```

- [ ] **Step 4: Run frontend build**

Run:

```powershell
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Expected: Vite build succeeds.

Remove only the generated `.vite-build-tmp` folder after verification.

Implementation check: do not change `body: testWebhook.body` to `body: JSON.stringify(testWebhook.body)`. For Razorpay fixtures, the backend already returns the exact signed body string.

## Task 4: Add Fixture Picker To Setup Rail

**Files:**

- Modify: `frontend/src/ui.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/SetupRail.jsx`

- [ ] **Step 1: Add fixture option metadata**

In `frontend/src/ui.js`, add this export near the top-level constants:

```javascript
export const razorpayFixtureOptions = [
  { key: 'payment_captured', label: 'Payment captured' },
  { key: 'payment_failed', label: 'Payment failed' },
  { key: 'order_paid', label: 'Order paid' },
  { key: 'refund_processed', label: 'Refund processed' },
  { key: 'subscription_charged', label: 'Subscription charged' },
]
```

- [ ] **Step 2: Add selected fixture state in `App.jsx`**

In `frontend/src/App.jsx`, update the imports from `./ui.js` to include:

```javascript
  razorpayFixtureOptions,
```

Add state near the existing Razorpay state:

```jsx
  const [selectedFixtureKey, setSelectedFixtureKey] = useState('payment_captured')
```

Change the `SetupRail` props from:

```jsx
              onTriggerTest={sendTestWebhook}
```

To:

```jsx
              fixtureOptions={razorpayFixtureOptions}
              selectedFixtureKey={selectedFixtureKey}
              onFixtureChange={setSelectedFixtureKey}
              onTriggerTest={() => sendTestWebhook(selectedFixtureKey)}
```

- [ ] **Step 3: Add props to `SetupRail`**

In `frontend/src/components/SetupRail.jsx`, add these props to the function signature after `testState`:

```jsx
  fixtureOptions,
  selectedFixtureKey,
  onFixtureChange,
```

- [ ] **Step 4: Add the fixture picker in Razorpay mode**

In the `Send Test` setup card, replace the current expected-result block:

```jsx
          <div className="setup-value compact">
            <strong>Expected result</strong>
            <span className="setup-url">
              The feed updates immediately. If forwarding is configured, HookRelay tries it on the same pass.
            </span>
          </div>
```

With:

```jsx
          {provider === 'razorpay' ? (
            <div className="setup-value input-card">
              <strong>Razorpay fixture</strong>
              <select
                className="text-input"
                value={selectedFixtureKey}
                onChange={(event) => onFixtureChange(event.target.value)}
                style={{ marginTop: 8 }}
              >
                {fixtureOptions.map((fixture) => (
                  <option key={fixture.key} value={fixture.key}>{fixture.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="setup-value compact">
              <strong>Expected result</strong>
              <span className="setup-url">
                The feed updates immediately. If forwarding is configured, HookRelay tries it on the same pass.
              </span>
            </div>
          )}
```

- [ ] **Step 5: Update button text for Razorpay mode**

In the same card, change:

```jsx
                    : 'Trigger Test Event'}
```

To:

```jsx
                    : provider === 'razorpay' ? 'Send Fixture' : 'Trigger Test Event'}
```

- [ ] **Step 6: Run frontend build**

Run:

```powershell
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Expected: Vite build succeeds.

Remove only the generated `.vite-build-tmp` folder after verification.

## Task 5: Label Fixture Events In The Event List And Inspector

**Files:**

- Modify: `frontend/src/components/EventList.jsx`
- Modify: `frontend/src/components/EventInspector.jsx`

- [ ] **Step 1: Show local fixture pill in the event list**

In `frontend/src/components/EventList.jsx`, inside the event row title pill group, after the existing replay pill:

```jsx
                          {event.method === 'REPLAY' ? <span className="pill replay">Replay</span> : null}
```

Add:

```jsx
                          {event.is_local_fixture ? <span className="pill warning">Local fixture</span> : null}
```

- [ ] **Step 2: Add fixture metadata to inspector**

In `frontend/src/components/EventInspector.jsx`, inside the Meta tab first `meta-grid`, after the `Event ID` pill, add:

```jsx
                  <div className="meta-pill">
                    <span className="meta-label">Fixture</span>
                    <span className="meta-value">{event.is_local_fixture ? 'Local fixture' : 'Provider delivery'}</span>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-label">Fixture key</span>
                    <span className="meta-value mono-text">{event.fixture_key || 'Not available'}</span>
                  </div>
```

- [ ] **Step 3: Run frontend build**

Run:

```powershell
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Expected: Vite build succeeds.

Remove only the generated `.vite-build-tmp` folder after verification.

## Task 6: Manual Fixture Checks

**Files:**

- No file changes.

- [ ] **Step 1: Start the stack**

Run:

```powershell
docker compose up --build -d
```

Expected: local app is reachable at `http://localhost`.

- [ ] **Step 2: Configure Razorpay mode with a secret**

Use the API or UI to set endpoint `fixture-diagnostics` to Razorpay mode and save a webhook secret.

Expected:

- config save succeeds
- API response says `razorpay_webhook_secret_configured: true`
- secret value is not returned

- [ ] **Step 3: Send each fixture through the UI**

Use the fixture picker and send:

- `Payment captured`
- `Payment failed`
- `Order paid`
- `Refund processed`
- `Subscription charged`

Expected for each:

- event appears in the feed
- event has `Local fixture` pill
- event has `signature_status: valid`
- event has the expected Razorpay event type
- event has the expected extracted Razorpay ID when present

- [ ] **Step 4: Verify prepared request uses capture path**

Confirm each fixture appears as a normal `POST` event from `/hooks/{session_id}`.

Expected:

- no fixture endpoint inserts events directly
- WebSocket receives the event like any other captured webhook

- [ ] **Step 5: Verify no-secret behavior**

Clear the Razorpay secret and send `Payment captured` again.

Expected:

- event appears in the feed
- event has `Local fixture` pill
- event has `signature_status: missing_secret`
- no `X-Razorpay-Signature` header is present

- [ ] **Step 6: Verify forwarding and replay**

Configure a forward URL that returns `200`, send `Payment captured`, then replay the captured event.

Expected:

- fixture event forwards successfully
- replay creates a new `REPLAY` event
- replay keeps the local fixture headers
- duplicate detection marks replay as duplicate when the fixture has the same `X-Razorpay-Event-Id`

## Final Verification

Run:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
python -m py_compile backend/app/main.py backend/app/razorpay_fixtures.py
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

- [ ] Do not store fixture status in the database.
- [ ] Do not expose the Razorpay webhook secret to the frontend.
- [ ] Do not add a provider framework.
- [ ] Do not add a go-live checklist.
- [ ] Do not change forwarding or replay behavior beyond preserving fixture labels through existing headers.
- [ ] Do not fake provider delivery: label local fixtures as local fixtures.
- [ ] Every changed line must trace to Phase 7.

## Not In This Phase

- [ ] No Razorpay dashboard API update.
- [ ] No Cloudflare tunnel automation.
- [ ] No go-live readiness checklist.
- [ ] No background retry engine.
- [ ] No hosted SaaS behavior.
- [ ] No multi-provider fixture registry.
