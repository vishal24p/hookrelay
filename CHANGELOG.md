# Changelog

All notable changes to HookRelay are documented here.

## [1.0.0] - 2026-06-04

First public hardening release for the Razorpay-first local webhook workbench:
public tunnel ingest, local forwarding, replay, and a safer developer-machine
runtime.

### Added

- Razorpay mode with optional HMAC signature verification.
- Cloudflare tunnel ingress for named tunnels and quick tunnels.
- Local forwarding to a configured `forward_url` with SSRF guardrails.
- Replay for captured events, including persisted replay rows on forward failure.
- Razorpay fixture generation for common payment, order, refund, and subscription events.
- Duplicate detection, replay payload helpers, and forward diagnostics.
- WebSocket live feed with reconnect tracking.
- Per-session bearer token protection for the local control plane and WebSocket.
- OSS scaffolding for license, contribution, security, issue, PR, CI, and Dependabot workflows.
- Makefile targets for tests, lint, build, compose validation, local stack control, and health checks.
- Frontend Vitest coverage, ESLint, and Prettier setup.
- Alembic migration stack and async SQLAlchemy database engine.
- Webhook body size cap with 413 responses.

### Changed

- Default dashboard port is `8080`, configurable with `HOOKRELAY_HTTP_PORT`.
- Production-shaped Docker images no longer use floating `latest` tags.
- Frontend container builds use lockfile-based `npm ci`.
- `make health` curls the application health endpoint through the local ingress.
- Compose now requires explicit Postgres credentials before configuration or startup.

### Fixed

- Public ingress Docker DNS resolution.
- Event serialization moved into a dedicated module.
- Tunnel startup writes status, waits longer for quick-tunnel URLs, and fails visibly when no URL is produced.
- WebSocket Redis pubsub handling is bounded and includes heartbeat/error handling.
- Browser storage failures are surfaced instead of silently swallowed.

### Security

- CORS is restricted to explicit origins and does not allow credentials.
- `forward_url` validation blocks loopback, private, metadata, and service hosts unless explicitly overridden for local debugging.
- Compose fails fast when `POSTGRES_USER`, `POSTGRES_PASSWORD`, or `POSTGRES_DB` are missing.
- Razorpay signatures are enforced when Razorpay mode has a configured secret.

## [Unreleased]

### Added

### Changed

### Fixed
