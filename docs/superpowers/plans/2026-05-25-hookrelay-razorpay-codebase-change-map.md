# HookRelay Razorpay Codebase Change Map

## Purpose

This file maps the current HookRelay codebase to the Razorpay-first change. It is not an implementation plan for a single feature. It defines what to keep, what to remove, what to update, and what to avoid so later feature plans stay small and focused.

## Current Project Shape

HookRelay already has useful local webhook workbench behavior:

- Public webhook ingest through the tunnel and nginx.
- FastAPI capture of raw request body, headers, and query params.
- Postgres persistence of captured events and endpoint config.
- Redis publish and WebSocket updates to the browser.
- React dashboard for endpoint setup, event feed, event inspector, forwarding result, and replay.
- Forwarding from HookRelay into a developer's local application.

The pivot should build on this core. It should not rebuild the app from scratch.

## Keep

- [ ] Keep webhook capture in `backend/app/main.py`.
  - Reason: Razorpay webhooks still arrive as HTTP POST requests.
  - Razorpay goal: preserve real webhook payloads for signature checks and replay.

- [ ] Keep `WebhookEvent` storage in `backend/app/models.py`.
  - Reason: Razorpay debugging needs event history, raw body, headers, query params, and received time.
  - Razorpay goal: inspect repeated deliveries and event order.

- [ ] Keep forwarding through `forward_webhook`.
  - Reason: developer still needs to send captured Razorpay events to a local app.
  - Razorpay goal: show whether the local handler returns 2xx, timeout, or error.

- [ ] Keep replay behavior.
  - Reason: replay is needed to test idempotency and local handler fixes.
  - Razorpay goal: replay the same event ID to verify duplicate handling.

- [ ] Keep Redis/WebSocket update flow.
  - Reason: the UI should update when Razorpay sends a webhook.
  - Razorpay goal: show real-time signature and forwarding diagnostics.

- [ ] Keep the existing React feed and inspector as the base UI.
  - Reason: they already show captured events and event details.
  - Razorpay goal: add Razorpay-specific diagnostics without inventing a new UI surface.

- [ ] Keep Cloudflare tunnel and public/local URL split.
  - Reason: Razorpay cannot call `localhost` directly.
  - Razorpay goal: provide one public webhook URL that forwards into the local machine.

## Remove Fully

- [ ] Remove GitHub webhook env config from backend startup.
  - Remove `GITHUB_WEBHOOK_TOKEN`, `GITHUB_WEBHOOK_OWNER`, `GITHUB_WEBHOOK_REPO`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_WEBHOOK_SESSION_ID`, `GITHUB_WEBHOOK_EVENTS`, `GITHUB_WEBHOOK_AUTOCONFIG`, and `GITHUB_WEBHOOK_POLL_INTERVAL_SECONDS`.
  - Reason: GitHub automation is not part of the Razorpay-first product.

- [ ] Remove GitHub API helper functions from `backend/app/main.py`.
  - Remove GitHub request header builder, hook matching, hook selection, list/create/update hook functions, reconcile loop, and background task.
  - Reason: keeping unrelated provider automation makes the backend harder to reason about.

- [ ] Remove `/integrations/github/status` and `/integrations/github/reconcile` routes.
  - Reason: they expose a provider-specific feature outside the Razorpay roadmap.

- [ ] Remove `GitHubWebhookStatusOut` from `backend/app/schemas.py`.
  - Reason: the schema will be unused after GitHub routes are removed.

- [ ] Remove `GITHUB_WEBHOOK_*` entries from `docker-compose.yml`.
  - Reason: local setup should not advertise GitHub as a first-class workflow.

## Update

- [ ] Update `SessionConfig`.
  - Add provider mode with at least `generic` and `razorpay`.
  - Add local Razorpay webhook secret storage.
  - Do not return the secret through API responses.
  - Return only whether a Razorpay secret is configured.

- [ ] Update session config API.
  - Accept provider mode.
  - Accept Razorpay webhook secret.
  - Allow clearing the secret.
  - Keep forward URL behavior unchanged.

- [ ] Update event serialization.
  - Include computed Razorpay diagnostics for events on Razorpay endpoints.
  - Include signature status, signature message, Razorpay event type, Razorpay event ID, and duplicate information.
  - Do not store provider diagnostics in the first pass unless required by later tests.

- [ ] Update event inspector UI.
  - Add a Razorpay diagnostics section.
  - Show signature status clearly.
  - Show Razorpay event type and event ID.
  - Show duplicate warning when the same Razorpay event ID appears more than once for the endpoint.

- [ ] Update setup rail UI.
  - Make Razorpay mode explicit.
  - Show Razorpay-ready public URL.
  - Explain manual dashboard setup in direct steps.
  - Keep local forward target setup visible.

- [ ] Replace the current fake test payload.
  - Current payload uses `payment.captured` with generic fields and USD.
  - Replace it with either a clearly generic test event or a Razorpay-shaped fixture when Razorpay mode is enabled.

## Do Not Touch Yet

- [ ] Do not build multi-provider architecture.
  - Reason: one provider does not justify a provider framework.

- [ ] Do not build Razorpay dashboard auto-update.
  - Reason: public URL display and manual setup are enough for first validation.

- [ ] Do not replace the storage layer.
  - Reason: Postgres already supports the current local workbench.

- [ ] Do not remove generic capture.
  - Reason: generic capture remains useful, but it is no longer the product pitch.

- [ ] Do not build a hosted service.
  - Reason: project direction is open source and local developer machine.

- [ ] Do not add complex migrations until a feature requires them.
  - Reason: keep the first pivot small. If schema changes are needed, use a simple local upgrade path and document that local DB reset may be needed during development.

## Build Constraints

- [ ] Keep changes surgical. Every changed line must support Razorpay-first local webhook debugging.
- [ ] Prefer computed diagnostics over new stored state when possible.
- [ ] Avoid abstractions until a second payment provider is actually planned.
- [ ] Keep generic behavior working after GitHub removal.
- [ ] Verify each phase with concrete commands and manual checks.

## Acceptance Criteria For This Change Map

- [ ] A later implementation plan can point to this file and know what to keep.
- [ ] A later implementation plan can point to this file and know what to remove.
- [ ] The codebase pivot stays Razorpay-first, not generic-provider-first.
- [ ] No code changes are implied without a separate exact feature plan.
