# Razorpay Duplicate Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn when Razorpay delivers the same `x-razorpay-event-id` more than once on the same endpoint.

**Architecture:** Keep duplicate detection computed at serialization time. Do not store duplicate status in the database. Extract the event-list comparison into a small pure helper so duplicate behavior can be tested without importing the FastAPI app or starting Postgres.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, React, Vite, Python `unittest`.

---

## Current State

`backend/app/main.py` already computes `duplicate_of_id` by scanning older events from the same session. `frontend/src/components/EventInspector.jsx` shows `Duplicate of`, but it is visually neutral and not enough of a warning.

This plan finishes roadmap Phase 5 only. Do not add fixture selection, forward retry classification, go-live checklist, or a provider framework.

## Task 1: Extract Duplicate Comparison Helper

**Files:**
- Create: `backend/app/razorpay_duplicates.py`
- Create: `backend/tests/test_razorpay_duplicates.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add the pure helper**

Create `backend/app/razorpay_duplicates.py`:

```python
def _header_value(headers: dict | None, name: str) -> str | None:
    if not headers:
        return None
    expected = name.lower()
    for key, value in headers.items():
        if str(key).lower() == expected:
            return str(value)
    return None


def find_duplicate_event_id_in_previous_events(
    previous_events,
    provider_event_id: str | None,
    event_id_header: str,
) -> int | None:
    if not provider_event_id:
        return None

    for previous_event in previous_events:
        previous_event_id = _header_value(getattr(previous_event, "headers", None), event_id_header)
        if previous_event_id == provider_event_id:
            return getattr(previous_event, "id", None)
    return None
```

- [ ] **Step 2: Add tests for duplicate comparison**

Create `backend/tests/test_razorpay_duplicates.py`:

```python
import unittest
from types import SimpleNamespace

from backend.app.razorpay_duplicates import find_duplicate_event_id_in_previous_events


class RazorpayDuplicateTests(unittest.TestCase):
    def test_returns_first_previous_event_with_same_event_id(self):
        previous_events = [
            SimpleNamespace(id=10, headers={"x-razorpay-event-id": "evt_same"}),
            SimpleNamespace(id=11, headers={"x-razorpay-event-id": "evt_same"}),
        ]

        duplicate_id = find_duplicate_event_id_in_previous_events(
            previous_events,
            "evt_same",
            "x-razorpay-event-id",
        )

        self.assertEqual(duplicate_id, 10)

    def test_header_lookup_is_case_insensitive(self):
        previous_events = [
            SimpleNamespace(id=20, headers={"X-Razorpay-Event-Id": "evt_case"}),
        ]

        duplicate_id = find_duplicate_event_id_in_previous_events(
            previous_events,
            "evt_case",
            "x-razorpay-event-id",
        )

        self.assertEqual(duplicate_id, 20)

    def test_returns_none_without_provider_event_id(self):
        previous_events = [
            SimpleNamespace(id=30, headers={"x-razorpay-event-id": "evt_present"}),
        ]

        duplicate_id = find_duplicate_event_id_in_previous_events(
            previous_events,
            None,
            "x-razorpay-event-id",
        )

        self.assertIsNone(duplicate_id)

    def test_returns_none_when_no_previous_event_matches(self):
        previous_events = [
            SimpleNamespace(id=40, headers={"x-razorpay-event-id": "evt_other"}),
            SimpleNamespace(id=41, headers={}),
        ]

        duplicate_id = find_duplicate_event_id_in_previous_events(
            previous_events,
            "evt_current",
            "x-razorpay-event-id",
        )

        self.assertIsNone(duplicate_id)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run the focused duplicate tests and confirm they pass**

Run:

```powershell
python -m unittest backend.tests.test_razorpay_duplicates
```

Expected:

```text
Ran 4 tests
OK
```

- [ ] **Step 4: Wire `main.py` to the helper**

In `backend/app/main.py`, import the helper:

```python
from .razorpay_duplicates import find_duplicate_event_id_in_previous_events
```

Then replace the loop inside `find_duplicate_razorpay_event_id()` with:

```python
return find_duplicate_event_id_in_previous_events(
    previous_events,
    provider_event_id,
    RAZORPAY_EVENT_ID_HEADER,
)
```

Keep the existing database query filters:

```python
models.WebhookEvent.session_id == event.session_id
models.WebhookEvent.id < event.id
```

Those filters are what keep duplicate detection scoped to the same endpoint and earlier events only.

- [ ] **Step 5: Run backend verification**

Run:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
python -m py_compile backend/app/main.py backend/app/razorpay_duplicates.py
```

Expected: all tests pass and compile exits with code `0`.

## Task 2: Make Duplicate Warning Clear In Inspector

**Files:**
- Modify: `frontend/src/components/EventInspector.jsx`

- [ ] **Step 1: Add local display constants near the top of `EventInspector`**

Inside the `EventInspector` function, after `tabs`, add:

```jsx
  const duplicateLabel = event?.duplicate_of_id
    ? event.method === 'REPLAY'
      ? 'Replay duplicate test'
      : 'Duplicate delivery'
    : event?.provider_event_id
      ? 'No duplicate found'
      : 'Duplicate check unavailable'

  const duplicateMessage = event?.duplicate_of_id
    ? `Same Razorpay event ID as Event #${event.duplicate_of_id}.`
    : event?.provider_event_id
      ? 'No earlier event on this endpoint has the same Razorpay event ID.'
      : 'Razorpay event ID is missing, so HookRelay cannot compare deliveries.'
```

- [ ] **Step 2: Replace the neutral duplicate row**

Replace the current `Duplicate of` meta pill with:

```jsx
                    <div className="meta-pill">
                      <span className="meta-label">Duplicate check</span>
                      <span className="meta-value">{duplicateLabel}</span>
                    </div>
```

- [ ] **Step 3: Add a warning pill only when a duplicate exists**

Inside the existing `inspector-summary-strip`, after the signature pill/message, add:

```jsx
                    {event.duplicate_of_id ? (
                      <span className="pill warning">{duplicateMessage}</span>
                    ) : (
                      <span className="pill">{duplicateMessage}</span>
                    )}
```

- [ ] **Step 4: Run frontend verification**

Run:

```powershell
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Expected: Vite build succeeds.

Remove only the generated `.vite-build-tmp` folder after verification.

## Task 3: Manual Duplicate Scenario Check

**Files:**
- No file changes.

- [ ] **Step 1: Start the app**

Run:

```powershell
docker compose up --build
```

Expected: local app is available through the existing local ingress.

- [ ] **Step 2: Set one endpoint to Razorpay mode**

Use the UI to switch the current endpoint to Razorpay mode. A secret is not required for duplicate detection.

- [ ] **Step 3: Send two events with the same Razorpay event ID**

Run twice against the same endpoint ID:

```powershell
curl -X POST http://localhost/api/hooks/<endpoint-id> `
  -H "Content-Type: application/json" `
  -H "X-Razorpay-Event-Id: evt_duplicate_test" `
  -d "{\"event\":\"payment.captured\",\"payload\":{\"payment\":{\"entity\":{\"id\":\"pay_duplicate\",\"order_id\":\"order_duplicate\"}}}}"
```

Expected:

- The first event shows `No duplicate found`.
- The second event shows `Duplicate delivery`.
- The second event message names the first event number.

- [ ] **Step 4: Send the same event ID to a different endpoint**

Run the same `curl` command against a different endpoint ID.

Expected: that event does not point back to the first endpoint's event.

- [ ] **Step 5: Replay the first duplicate-capable event**

Use the UI replay button on an event that has `X-Razorpay-Event-Id`.

Expected: the replay event shows `Replay duplicate test` and points to the original event.

## Final Verification

Run:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
python -m py_compile backend/app/main.py backend/app/razorpay_duplicates.py
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
git diff --check
```

Expected:

- Backend tests pass.
- Python compile passes.
- Frontend build passes.
- `git diff --check` has no output.
- `.vite-build-tmp` is deleted after build verification.

## Assumptions

- Duplicate detection remains Razorpay-only because it depends on `x-razorpay-event-id`.
- `duplicate_of_id` remains computed, not stored.
- Existing replay behavior keeps original headers and body; this is enough for replay to become a duplicate test.
- No database migration is needed.
