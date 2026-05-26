# Razorpay Metadata Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract useful Razorpay IDs from captured webhook bodies and show them in the event inspector.

**Architecture:** Keep metadata computed at read/serialize time. Do not store extracted IDs in the database. Add one small pure helper for Razorpay body parsing so it can be tested without importing the FastAPI app or touching Postgres.

**Tech Stack:** FastAPI, Pydantic v2, React, Vite, Python `unittest`.

---

## Summary

Implement only roadmap Phase 4: Razorpay Metadata Extraction.

Do not add fixtures, signed fixture generation, go-live checklist, dashboard auto-update, or a provider framework.

This plan assumes the current cleanup/config/signature work remains in place.

## Key Changes

- Create `backend/app/razorpay_metadata.py`.
- Add optional API fields to `WebhookEventOut`:
  - `razorpay_payment_id`
  - `razorpay_order_id`
  - `razorpay_refund_id`
  - `razorpay_subscription_id`
- Update `build_razorpay_diagnostics()` to merge extracted IDs into the serialized event.
- Update `EventInspector` Razorpay diagnostics to display the four IDs.
- Add `backend/tests/test_razorpay_metadata.py` using `unittest`.

## Extraction Rules

- Input is the parsed JSON body dict; invalid JSON or non-object body returns all fields as `None`.
- `provider_event_type`: body field `event` if it is a string.
- `razorpay_payment_id`:
  - first `payload.payment.entity.id`
  - fallback `payload.refund.entity.payment_id`
- `razorpay_order_id`:
  - first `payload.order.entity.id`
  - fallback `payload.payment.entity.order_id`
  - fallback `payload.refund.entity.order_id`
- `razorpay_refund_id`:
  - `payload.refund.entity.id`
- `razorpay_subscription_id`:
  - first `payload.subscription.entity.id`
  - fallback `payload.payment.entity.subscription_id`
- If a value is missing or not a string, return `None`.
- Do not raise on missing keys, bad shapes, arrays, numbers, or `null`.

## Implementation Tasks

### Task 1: Pure Metadata Extractor

**Files:**
- Create: `backend/app/razorpay_metadata.py`
- Create: `backend/tests/test_razorpay_metadata.py`

- [ ] Add `extract_razorpay_metadata(body: dict | None) -> dict[str, str | None]`.
- [ ] Add a private helper that safely reads nested dict paths.
- [ ] Add tests for:
  - `payment.captured` extracts event type, payment ID, and order ID.
  - `order.paid` extracts event type and order ID.
  - refund payload extracts refund ID and payment ID.
  - subscription payload extracts subscription ID.
  - missing optional IDs return `None`.
  - invalid input shapes return `None` fields without exceptions.
- [ ] Run: `python -m unittest discover -s backend/tests -p "test_*.py"`
- [ ] Expected: all metadata tests pass.

### Task 2: API Serialization

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`

- [ ] Add the four optional Razorpay ID fields to `WebhookEventOut`.
- [ ] Import `extract_razorpay_metadata` in `main.py`.
- [ ] In `build_razorpay_diagnostics()`, call the helper only for Razorpay mode after `parse_json_body(event.body)`.
- [ ] Keep generic endpoints returning `None` for all Razorpay ID fields.
- [ ] Keep signature diagnostics behavior unchanged.
- [ ] Run: `python -m py_compile backend/app/main.py backend/app/schemas.py backend/app/razorpay_metadata.py`
- [ ] Expected: no output and exit code `0`.

### Task 3: Inspector UI

**Files:**
- Modify: `frontend/src/components/EventInspector.jsx`

- [ ] Add four rows inside the existing Razorpay diagnostics section:
  - Payment ID
  - Order ID
  - Refund ID
  - Subscription ID
- [ ] Use existing `meta-pill`, `meta-label`, `meta-value`, and `mono-text` classes.
- [ ] Display `Not available` when the value is absent.
- [ ] Do not create a new tab.
- [ ] Run: `npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir`
- [ ] Expected: Vite build succeeds.
- [ ] Remove only the generated `.vite-build-tmp` folder after verification.

## Test Plan

- Backend unit tests:
  - `python -m unittest discover -s backend/tests -p "test_*.py"`
- Backend syntax:
  - `python -m py_compile backend/app/main.py backend/app/schemas.py backend/app/razorpay_metadata.py`
- Frontend build:
  - `npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir`
- Manual check after implementation:
  - Set endpoint mode to Razorpay.
  - Trigger the existing Razorpay test event.
  - Confirm inspector shows `payment.captured`, payment ID, and order ID.
  - Send malformed JSON and confirm raw body still displays and no diagnostics crash occurs.

## Assumptions

- No database migration is needed because metadata is computed, not stored.
- No new dependency is needed; use Python `unittest`.
- Existing signature and duplicate diagnostics stay as-is.
- This feature does not add fixture selection or signed fixture generation.
