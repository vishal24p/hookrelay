# HookRelay Razorpay Feature Roadmap

## Purpose

This file defines the product roadmap for HookRelay as a Razorpay-first open-source local webhook workbench. It is not the exact implementation plan for the first feature. Each phase below should become its own implementation plan before code changes begin.

## Product Goal

HookRelay should answer this developer question:

> I am integrating Razorpay locally. My webhook is failing. What exactly is wrong?

The project should help a developer verify Razorpay webhook correctness on their own machine. The first useful path is not a generic inbox. It is Razorpay-specific diagnosis on top of captured webhooks.

## Roadmap Order

### Phase 1: Cleanup

Remove unrelated GitHub automation and keep the generic webhook workbench working.

Success criteria:

- [ ] GitHub env config is gone from backend and compose.
- [ ] GitHub routes are gone.
- [ ] GitHub status schema is gone.
- [ ] App still captures webhook POST requests.
- [ ] App still forwards to local app.
- [ ] App still replays stored events.
- [ ] Browser still receives live events over WebSocket.

Verification:

- [ ] Backend imports without syntax errors.
- [ ] Compose config renders.
- [ ] A generic test webhook can be captured.
- [ ] Replay still creates a new event.

### Phase 2: Razorpay Endpoint Config

Add endpoint-level Razorpay mode and webhook secret configuration.

Success criteria:

- [ ] Endpoint can be set to `generic` or `razorpay`.
- [ ] Razorpay webhook secret can be saved locally.
- [ ] API never returns the secret value.
- [ ] API returns whether the secret is configured.
- [ ] UI clearly shows Razorpay mode and secret configured state.

Verification:

- [ ] Saving provider mode persists.
- [ ] Saving secret persists enough for backend verification.
- [ ] Fetching config does not expose the secret.
- [ ] Generic endpoint behavior remains unchanged.

### Phase 3: Razorpay Signature Diagnostics

Verify Razorpay webhook signatures using the exact raw request body.

Success criteria:

- [ ] Reads `X-Razorpay-Signature` from headers.
- [ ] Computes HMAC-SHA256 using the configured webhook secret.
- [ ] Uses raw stored body for verification.
- [ ] Produces status: `not_applicable`, `missing_secret`, `missing_signature`, `valid`, or `invalid`.
- [ ] Shows a human-readable reason in the event inspector.
- [ ] Captures invalid events instead of dropping them.

Verification:

- [ ] Valid signature shows `valid`.
- [ ] Wrong secret shows `invalid`.
- [ ] Missing signature shows `missing_signature`.
- [ ] Missing secret shows `missing_secret`.
- [ ] Generic endpoint shows `not_applicable`.

### Phase 4: Razorpay Metadata Extraction

Extract useful Razorpay fields from headers and body without making the parser fragile.

Success criteria:

- [ ] Extracts Razorpay event type from body field `event`.
- [ ] Extracts Razorpay event ID from `x-razorpay-event-id`.
- [ ] Extracts common IDs when present: payment ID, order ID, refund ID, subscription ID.
- [ ] Displays extracted values in the inspector.
- [ ] Invalid JSON body does not crash diagnostics.

Verification:

- [ ] `payment.captured` fixture shows event type and payment ID.
- [ ] `order.paid` fixture shows event type and order ID.
- [ ] Missing optional IDs show as unavailable, not as errors.
- [ ] Invalid JSON still shows raw body and signature status.

### Phase 5: Duplicate Detection

Warn when Razorpay sends the same event ID more than once.

Success criteria:

- [ ] Detects repeated `x-razorpay-event-id` within the same endpoint.
- [ ] Shows which earlier event has the same Razorpay event ID.
- [ ] Does not block or delete duplicates.
- [ ] Replay can intentionally create duplicate delivery for testing.

Verification:

- [ ] Two events with the same Razorpay event ID show duplicate warning on the later event.
- [ ] Events without Razorpay event ID do not show duplicate warning.
- [ ] Same event ID on a different endpoint does not count as duplicate.

### Phase 6: Forward And Replay Diagnostics

Make local handler behavior clear enough for Razorpay retry debugging.

Success criteria:

- [ ] Forward result shows status code, response body, and error.
- [ ] Non-2xx response is marked as retry risk.
- [ ] Timeout or connection failure is marked as delivery failure.
- [ ] Replay keeps original body and headers.
- [ ] Duplicate replay is clearly labeled as a duplicate test.

Verification:

- [ ] Local handler returning 200 shows success.
- [ ] Local handler returning 500 shows retry risk.
- [ ] Local handler unavailable shows connection error.
- [ ] Replay uses original event body.

### Phase 7: Razorpay Test Fixtures

Provide realistic local test events without pretending they are provider-sent events.

Success criteria:

- [ ] Fixtures exist for payment captured, payment failed, order paid, refund, and subscription.
- [ ] Fixture events are labeled as local fixtures.
- [ ] Fixture body shape is Razorpay-like.
- [ ] Fixture signatures can be generated when secret is configured.
- [ ] UI lets user choose a fixture and send it through the same capture path.

Verification:

- [ ] Fixture event appears in feed.
- [ ] Fixture signature verifies when secret is configured.
- [ ] Fixture can be forwarded to local app.
- [ ] Fixture can be replayed.

### Phase 8: Razorpay Go-Live Checklist

Show a practical readiness checklist based on captured evidence.

Success criteria:

- [ ] Checklist shows whether at least one valid signature was seen.
- [ ] Checklist shows whether duplicate handling was tested.
- [ ] Checklist shows whether local handler returned 2xx.
- [ ] Checklist shows whether replay was tested.
- [ ] Checklist reminds developer to use live webhook secret before production.

Verification:

- [ ] Empty endpoint shows incomplete checklist.
- [ ] Valid signed event updates signature checklist item.
- [ ] Duplicate event updates idempotency checklist item.
- [ ] Successful forward updates handler checklist item.

## Not In First Roadmap

- [ ] No hosted SaaS.
- [ ] No multi-provider framework.
- [ ] No Razorpay dashboard auto-update.
- [ ] No GitHub automation.
- [ ] No enterprise queue or retry engine.
- [ ] No production deployment hardening until local OSS value is proven.

## Build Constraints

- [ ] Build one phase at a time.
- [ ] Verify each phase before starting the next one.
- [ ] Do not add configuration before a concrete feature needs it.
- [ ] Do not add provider abstractions until at least two providers are planned.
- [ ] Keep UI changes focused on diagnostics developers can act on.
- [ ] Keep generic webhook behavior working unless a plan explicitly removes it.

## First Exact Feature Plan To Write Next

Write a separate implementation plan for:

> Cleanup plus Razorpay endpoint config and signature diagnostics.

That plan should include exact files, tests, UI changes, and verification commands. This roadmap should not be used as a direct coding checklist.
