# HookRelay Hardening And Open-Source Readiness Plan

**Date:** 2026-06-04
**Branch context:** `codex/split-public-ingest-local-control`
**Purpose:** Convert the consolidated issue list (security, silent-failure, dev-machine, open-source onboarding) into a sequenced, testable plan that an executing agent can follow task-by-task. This plan does **not** redo work the staged plans already shipped (public ingress fix, API smoke tests, event serialization extraction). It is the next layer.

---

## 0. Context: How This Plan Fits The Existing Plans

The `docs/superpowers/plans/` directory tells a clear story about where HookRelay has been and where it is going. I read every file there to ground this plan in the project's own direction rather than starting from scratch.

### 0.1 What the plans say HookRelay is

From `2026-05-26-hookrelay-architecture.md`, `2026-05-25-hookrelay-razorpay-feature-roadmap.md`, and `2026-05-25-hookrelay-razorpay-codebase-change-map.md`:

- **Product goal:** "I am integrating Razorpay locally. My webhook is failing. What exactly is wrong?"
- **Target user:** a developer running HookRelay on their own machine, with a public Cloudflare tunnel URL wired into Razorpay's dashboard.
- **Scope boundaries (explicit):**
  - Open source, local developer machine only. **No hosted SaaS.**
  - **Razorpay-first, not multi-provider.** "Avoid abstractions until a second payment provider is actually planned."
  - Generic webhook capture is kept for now but is not the product pitch.
  - No GitHub automation (already removed in the roadmap Phase 1).
  - No enterprise queue or retry engine.
  - No production deployment hardening until "local OSS value is proven."

### 0.2 What the staged plans already shipped (verified by reading the code)

| Plan | Files actually changed in code | Verified status |
|---|---|---|
| `2026-06-03-stage-01-public-ingress-502` | `nginx/public.conf` adds `resolver 127.0.0.11 valid=30s ipv6=off;` | ✅ Shipped, `ed419e1 fix: resolve public ingress Docker DNS lookup` |
| `2026-06-03-stage-02-backend-api-smoke-tests` | `backend/tests/test_api_smoke.py` (6 tests) | ✅ Shipped, `a5f2bbb test: add backend API smoke coverage` |
| `2026-06-03-stage-03-event-serialization-extraction` | New `backend/app/event_serialization.py`, helper modules | ✅ Shipped, `986d5ca refactor: extract event serialization` |

The three helper modules (`razorpay_metadata.py`, `razorpay_duplicates.py`, `razorpay_fixtures.py`, `forwarding_diagnostics.py`) and their unit tests exist exactly as the Phase 4-7 plans specified. The fixture diagnostics, duplicate-of pill, forward delivery status, and replay payload helper are all wired in and the test count is `Ran 31 tests in 0.537s` (Stage 03 report). The GitHub webhook code is fully gone from the backend and compose file.

**The codebase is well-updated relative to the staged plans.** No plan-vs-code drift in the Razorpay workstream.

### 0.3 What the plans explicitly do not cover (and where this plan begins)

`2026-05-26-hookrelay-codebase-cleanup-audit-plan.md` is the most relevant prior plan. It is the parent of the three stage plans that have already shipped. Its `## Recommended Implementation Order` listed:

1. Public ingress fix. *(shipped: stage 01)*
2. Public webhook E2E retest. *(shipped: stage 01 verification)*
3. Backend API smoke tests. *(shipped: stage 02)*
4. Backend low-risk extraction (serialization, Razorpay signature diagnostics). *(shipped: stage 03)*
5. Frontend CSS extraction. *(not shipped)*
6. Frontend event-first redesign. *(not shipped)*
7. Session/endpoint simplification. *(not shipped)*
8. Tunnel freshness indicator. *(not shipped)*

The cleanup audit also explicitly said: *"Do not start with a large refactor."* — and that the product still needed the public URL path to work first. With the public path now fixed, the cleanup audit's items 5-8 and the **out-of-scope-but-now-real problems surfaced by my code audit** are the work this plan addresses.

This plan does not invalidate the staged plans. It continues from the same point: serialization is extracted, route behavior is locked by 31 passing tests, and the project is a Razorpay-first local OSS workbench with a public-URL promise that now actually works.

### 0.4 Out-of-scope (reaffirmed)

Following the project's own constraints, this plan does **not**:

- Add a hosted SaaS mode.
- Build a multi-provider framework.
- Add a retry/queue engine.
- Auto-update Razorpay's dashboard.
- Re-architect `main.py` into a deep layered design.
- Add a new migration framework beyond what is already there.
- Rewrite the frontend to a new design system.

It does, however, fix the things the staged plans deliberately left for later (security, dev-machine ergonomics, open-source onboarding), and it does so in a way that respects the "build one phase at a time, verify, then move on" rhythm the staged plans established.

---

## 1. The Audit, Mapped To The Plan

Each issue below is one of the findings from my code audit. I have:

- Tagged whether it is in or out of any existing plan.
- Mapped it to one of the project's explicit product boundaries.
- Sequenced it behind prerequisites that already shipped.

For each tier I list:
- The finding (short)
- The source (file:line)
- A user-visible impact ("why a developer cares")
- A proposed fix and the verification command
- A status field for tracking

The "Source audit ID" column refers to the numbering in the consolidated issues list delivered earlier in this conversation. The "Tier" column follows the same Tier 0-4 convention.

---

## 2. Sequencing Principles

The plan is ordered by:

1. **Stop-the-bleeding first** (security + silent failures that lie).
2. **Then make the dev machine work** (port 80, host.docker.internal, default creds, frontend Dockerfile, lockfile, env completeness).
3. **Then make the OSS contribution story work** (LICENSE conflict marker, `.github/`, CI, Makefile, ESLint, frontend tests).
4. **Then scale and operate** (Alembic, structured logging, async DB, body size, retention, async forwarder, replay audit, WebSocket hardening).
5. **Then the cleanup audit's deferred UI work** (CSS extraction, event-first layout) — kept as a follow-up, not in this plan's body.

Each task below is sized for one focused PR. Each task has an explicit verification step. Tasks that change behavior include test cases. Tasks that are pure infra (CI, config) do not.

---

## 3. Tier 0: One-Line Fixes (Land Today)

These are tiny, do not change behavior, and unblock everything else. Ship as a single PR if possible.

### Task 0.1 — Fix the git conflict marker in `LICENSE`

- **Audit ID:** Tier 0.1
- **File:** `LICENSE:1`
- **Current:**
  ```text
  <<<<<<< HEAD
  MIT License
  Copyright (c) 2026 HookRelay Contributors
  ```
- **Why a developer cares:** GitHub's license detector will refuse to label the repo. PyPI / npm license checks will fail. New visitors see a broken file.
- **Fix:** Resolve the conflict. The intended body is the standard MIT text for 2026 HookRelay Contributors. Confirm with `git log -- LICENSE` that there is no other branch that contributed alternative text.
- **Verification:** `head -1 LICENSE` returns `MIT License`. `git diff` shows a clean removal of the marker. CI license-checker (added in Tier 0.2) passes.

### Task 0.2 — Add minimal `.github/` scaffolding

- **Audit ID:** Tier 0.2
- **New files:**
  - `.github/CODE_OF_CONDUCT.md` — Contributor Covenant v2.1 (verbatim, with maintainer email placeholder).
  - `.github/SECURITY.md` — "Report vulnerabilities to <security email or GitHub Security Advisories>. We aim to acknowledge within 5 business days."
  - `.github/CONTRIBUTING.md` — "Run `python -m unittest discover -s backend\tests -p test_*.py`. Run `npm run build` from `frontend/`. Open a PR."
  - `.github/PULL_REQUEST_TEMPLATE.md` — 4-bullet template (what / how / screenshots / risk).
  - `.github/ISSUE_TEMPLATE/bug.yml` — minimal: repro, expected, actual, env.
  - `.github/ISSUE_TEMPLATE/feature_request.yml` — minimal: problem, proposed solution, alternatives.
  - `.github/dependabot.yml` — `npm` and `pip` ecosystems, weekly schedule, grouped minor/patch, `open-pull-requests-limit: 5`.
  - `.github/workflows/ci.yml` — see Task 0.3.
- **Why a developer cares:** A new contributor lands on the repo and finds nothing — no `CONTRIBUTING.md`, no templates, no security disclosure path. The project reads as "one-person side project" even when the code is structured for handoff.
- **Fix:** Add the files above verbatim. No code changes.
- **Verification:** GitHub renders all seven files. `dependabot.yml` validates (GitHub will show a red banner on a bad file). CI workflow runs on push.

### Task 0.3 — Add CI workflow

- **Audit ID:** Tier 0.4 (test absence) + Tier 0.2 (no CI)
- **New file:** `.github/workflows/ci.yml`
- **Jobs:**
  1. `backend-tests` — `actions/checkout@v4`, `actions/setup-python@v5` with `python-version: "3.11"`, `pip install -r backend/requirements.txt`, `python -m unittest discover -s backend/tests -p test_*.py`.
  2. `frontend-build` — `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: "20"`, `cd frontend`, `npm ci`, `npm run build` (also requires adding the `build` script — see Tier 3 task).
  3. `lint-frontend` — same checkout + node, `cd frontend`, `npm run lint` (also requires adding ESLint config — see Tier 3 task).
  4. `license-check` — verifies `LICENSE` exists, starts with `MIT License`, does not contain `<<<<<<<`. Cheap shell command.
- **Why a developer cares:** PRs without CI are PRs without a contract. Today, nothing tells a contributor whether their change broke the suite.
- **Fix:** Add the workflow. No application code change.
- **Verification:** Push a branch; CI runs the three jobs green. (Triggers only on PR open; no need to wait for first scheduled run.)

### Task 0.4 — Add a top-level `Makefile`

- **Audit ID:** Tier 0.4
- **New file:** `Makefile`
- **Targets:**
  ```makefile
  .PHONY: test test-one lint build dev up down logs clean

  test:
      python -m unittest discover -s backend/tests -p "test_*.py"

  test-one:
      python -m unittest $(FILE)

  lint:
      cd frontend && npm run lint

  build:
      cd frontend && npm run build

  dev:
      docker compose up --build

  up:
      docker compose up -d

  down:
      docker compose down

  logs:
      docker compose logs -f

  clean:
      rm -rf frontend/.vite-build-tmp frontend/dist
  ```
- **Why a developer cares:** Running a single test today is `python -m unittest backend.tests.test_razorpay_metadata` from the repo root, with a non-obvious `sys.path` quirk. A Makefile removes the friction.
- **Fix:** Add the file. Document in `CONTRIBUTING.md`.
- **Verification:** `make test` runs the suite from the repo root. `make test-one FILE=backend.tests.test_razorpay_metadata` runs one file.

### Task 0.5 — Remove the duplicate `tunnel_url.txt` gitignore entry

- **Audit ID:** Tier 2.6
- **File:** `.gitignore:43, 71`
- **Current:** both `tunnel/tunnel_url.txt` and `tunnel_url.txt` patterns.
- **Fix:** Remove `tunnel/tunnel_url.txt` (the actual file is in the `tunnel_data` volume, not the source tree).
- **Verification:** `git status` is clean for `.gitignore` after the edit; `git check-ignore tunnel/tunnel_url.txt` returns non-zero.

---

## 4. Tier 1: Security — Stop The Worst Holes First

These five items, in this order, are the difference between "open-source toy" and "open-source tool you can publish." They are all in the project's scope (the staged plans explicitly say security on the public-facing path matters; see cleanup audit P0 about public ingress — Tier 1 is the next layer of that thinking).

### Task 1.1 — Reject ingest when signature is missing or invalid (Razorpay mode)

- **Audit ID:** Tier 1.1
- **File:** `backend/app/main.py:141-194` (`receive_webhook`); `backend/app/event_serialization.py:87-121` (`build_razorpay_diagnostics`)
- **Current behavior:** Signature verification runs but the result is purely informational. Any POST to `/api/hooks/{session_id}` is stored, forwarded, and shown in the dashboard.
- **Why a developer cares:** The whole Razorpay-first promise is "securely receive Razorpay webhooks locally." Right now an attacker who learns a session ID can plant arbitrary events. The dashboard lies about what Razorpay sent.
- **Fix:**
  1. In `event_serialization.py`, change `build_razorpay_diagnostics` to return both the diagnostics dict **and** the boolean `is_signature_acceptable` (true when `signature_status == "valid"`, or when status is `not_applicable` for non-Razorpay mode, or `missing_secret` if the developer intentionally accepted unverified mode).
  2. In `main.py:receive_webhook`, after computing the diagnostics, if `config.provider == "razorpay"` and not `is_signature_acceptable` and `signature_status in ("invalid", "missing_signature")`, return `401 {"detail": "Razorpay signature verification failed"}` without persisting the event. (The developer can opt out by leaving the secret blank — that stays `not_applicable` and is accepted.)
  3. Add a new test `test_receive_webhook_rejects_invalid_razorpay_signature` to `backend/tests/test_api_smoke.py`.
  4. Add `test_receive_webhook_accepts_missing_secret_in_razorpay_mode` to assert the opt-out path works (developer chose to run Razorpay mode without a secret for local-only debugging).
- **Why preserve the opt-out:** the project's roadmap Phase 3 says "Captures invalid events instead of dropping them" as a success criterion. We honor that for `missing_secret` but enforce integrity for `invalid` and `missing_signature` (the sender *did* sign, just wrong or absent).
- **Verification:** `python -m unittest discover -s backend\tests -p test_*.py` passes 33 tests (was 31). Manual: `curl -H "X-Razorpay-Event-Id: x" -d '{"event":"payment.captured"}' http://localhost/api/hooks/test returns 401 when a secret is configured; returns 200 when no secret is configured.

### Task 1.2 — Add per-session ingest token, surface on create, require on local control plane

- **Audit ID:** Tier 1.1, Tier 1.2, H1
- **Files:** `backend/app/models.py`, `backend/app/main.py`, `frontend/src/hooks/useEndpointState.jsx`, `frontend/src/App.jsx`
- **Current:** `local_control_router` has zero auth. Anyone on loopback (a sibling container, a port-forwarded attacker, a malicious browser extension) can read all events, plant `forward_url`s, and replay. The WebSocket `/ws/{session_id}` is open to any client that can guess the 8-char ID.
- **Fix:**
  1. Add a column `ingest_token TEXT NOT NULL` to `session_configs` (extend `ensure_session_config_columns` with `ADD COLUMN IF NOT EXISTS ingest_token TEXT`; no Alembic needed; same idempotency pattern the staged plans established).
  2. On `POST /sessions/{session_id}/init` (a new route — see below) generate `secrets.token_urlsafe(24)`, store hash (e.g. `hashlib.sha256(token).hexdigest()`) in the column, return the raw token **once** in the response. If the row already exists, rotate: require the existing token in the `Authorization: Bearer <token>` header, return a new token.
  3. Add `Authorization: Bearer <token>` dependency on every `local_control_router` route except `GET /health` and the existing public `POST /hooks/{session_id}`.
  4. On `GET /ws/{session_id}` WebSocket, check `websocket.headers.get("authorization") == "Bearer " + token` before `accept()`. Reject close code `1008` (policy violation) on mismatch.
  5. The frontend stores the token in `localStorage` keyed by session id (encrypted at rest in a future PR; for now, plain text in the developer's own browser is acceptable for a local OSS tool — document the trade-off in a code comment).
- **Why a developer cares:** This is the difference between "the dashboard is on a port only I can hit" and "the dashboard is on a port anyone on the loopback can hit." Combined with Task 1.1 it removes the two worst attack surfaces.
- **Verification:** New tests:
  - `test_local_control_requires_token` — without `Authorization`, all `local_control_router` routes return 401.
  - `test_websocket_rejects_wrong_token` — WS handshake without a valid token closes with 1008.
  - `test_session_init_creates_and_returns_token` — the init route generates a token, the token verifies against the stored hash on subsequent calls.
- **Out of scope (deferred):** rotating tokens, expiring tokens, rate limiting. The current local OSS tool does not need them yet.

### Task 1.3 — SSRF guard on `forward_url`

- **Audit ID:** Tier 1.3
- **Files:** `backend/app/schemas.py:40-43` (`SessionConfigIn`), `backend/app/main.py:107-134` (`forward_webhook`)
- **Current:** `forward_url` is `Optional[str]`. Any string is accepted. `httpx` follows redirects by default.
- **Why a developer cares:** A typo or a maliciously planted URL can probe `127.0.0.1:6379`, `169.254.169.254`, internal services on `host.docker.internal`. The `api` container has `extra_hosts: host-gateway`, so the host's loopback is reachable.
- **Fix:**
  1. Replace `Optional[str]` with `Optional[HttpUrl]` in `SessionConfigIn` (Pydantic v2). Reject anything not `http://` or `https://`.
  2. Add a `field_validator` that resolves the URL with `socket.getaddrinfo(host, port)` and rejects if any returned IP is in:
     - `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1/128`, `fc00::/7`, `fe80::/10`
     - or matches `0.0.0.0`, `localhost`, `host.docker.internal`, or the docker service name `postgres`/`redis`.
  3. Add an env override `ALLOW_LOOPBACK_FORWARD=1` that disables the IP check (for self-hosters who intentionally forward to internal services). Log a loud warning when set.
  4. In `forward_webhook`, construct `httpx.AsyncClient(..., follow_redirects=False)`. If a redirect is needed in the future, the helper should re-validate the new URL against the same allowlist.
- **Verification:** New tests:
  - `test_forward_url_validator_rejects_loopback_ip` — `http://127.0.0.1:3000` rejected.
  - `test_forward_url_validator_rejects_metadata_ip` — `http://169.254.169.254/` rejected.
  - `test_forward_url_validator_rejects_https_routable_ip` — `http://8.8.8.8/` accepted (with a log warning that the egress is leaving the host).
  - `test_forward_url_allow_loopback_override` — when `ALLOW_LOOPBACK_FORWARD=1`, loopback is accepted and a warning is logged.
  - `test_forward_webhook_does_not_follow_redirects` — mock a `httpx` transport that returns 302 to `127.0.0.1`; assert the client does not chase it.

### Task 1.4 — Fix CORS

- **Audit ID:** Tier 1.2
- **File:** `backend/app/main.py:93-99`
- **Current:** `allow_origins=["*"]` + `allow_credentials=True`. Browsers reject credentialed responses for `*`, but the configuration advertises the wrong intent.
- **Fix:** Drop `allow_credentials=True` (the API has no cookies; the new bearer token lives in `Authorization` headers, which are not subject to CORS credentials semantics). Restrict `allow_origins` to the configured frontend origin — read from env, default `http://localhost:5173` and `http://127.0.0.1`.
- **Why a developer cares:** This is the only "this project doesn't understand its security model" smell. It's a 5-line change.
- **Verification:** Manual: open `http://localhost/` in a browser, inspect response headers, confirm `Access-Control-Allow-Origin` matches the request origin (not `*`). Curl the API with `Origin: http://evil.example`; confirm the response lacks `Access-Control-Allow-Origin`.

### Task 1.5 — Fail-fast on default DB password

- **Audit ID:** Tier 1.6
- **File:** `docker-compose.yml:6, 43-48`; `backend/app/database.py:6-8`
- **Current:** `POSTGRES_USER=webhookuser`, `POSTGRES_PASSWORD=webhookpass` defaults. `.env.example` does not list them.
- **Fix:**
  1. Remove the defaults from `docker-compose.yml` and require explicit env values:

     ```yaml
     POSTGRES_USER: ${POSTGRES_USER:?POSTGRES_USER must be set}
     POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}
     POSTGRES_DB: ${POSTGRES_DB:?POSTGRES_DB must be set}
     ```
  2. Update `.env.example` to include the three with `# REQUIRED` markers and a 1-line note ("generate with `openssl rand -hex 32`").
  3. Update `database.py` to read `DATABASE_URL` (already does), but if `DATABASE_URL` is the default literal `postgresql://webhookuser:webhookpass@postgres:5432/webhookdb`, log a warning at startup.
  4. Add a one-line `Makefile` target `make init-env` that copies `.env.example` to `.env` and prompts to set the password.
- **Why a developer cares:** The defaults "work" out of the box, so a developer never copies `.env.example` to `.env` and silently lands on `webhookuser:webhookpass`. Anything else on `local_net` can connect.
- **Verification:** `docker compose up` without `.env` fails immediately with the `?:` error message. With a populated `.env`, the stack starts.

---

## 5. Tier 1.5: Stop The Tool From Lying

These are the silent-failure findings. They are not security holes but they make the tool actively misleading, which for a developer-machine workbench is the worst category of bug. Ship after Tier 1.

### Task 2.1 — Replay returns 502 on forward failure, client surfaces it

- **Audit ID:** Tier 1.13, Tier 4.14
- **Files:** `backend/app/main.py:241-294` (`replay_event`), `frontend/src/hooks/useEventStream.jsx:200-201` (`replayEvent`)
- **Current:** `replay_event` returns `200 {"status": "replayed", "id": ..., "forward_status": status}` even when `status is None` (forward threw). Frontend treats any 2xx as success and shows a green "Replayed" pill.
- **Fix:**
  1. In `replay_event`: if `error` is set (forward threw), return `502 {"status": "replay_delivery_failure", "id": event_id, "forward_error": error[:500]}`. Persist the `replay_event` row in either case (audit trail preserved). Status 502 only when forward was attempted and failed.
  2. In `useEventStream.jsx:replayEvent`, branch on `response.status`:
     - 200 → green pill, "Replayed."
     - 502 → red pill, "Replay sent but local handler was unreachable. See event row for details."
     - other → red pill, the existing error path.
  3. Add a new event row column `replay_delivery_status` derived from the same `forward_delivery_status` (replay events should show the same diagnostics).
- **Why a developer cares:** Clicking "Replay" and seeing green is the worst lie in the tool. The local handler never got the payload; the dev moves on, doesn't notice, gets bitten later.
- **Verification:** New tests:
  - `test_replay_returns_502_when_forward_throws` — patch `forward_webhook` to raise, assert 502.
  - `test_replay_returns_200_when_forward_succeeds` — existing test, still passes.

### Task 2.2 — WebSocket reconnects with exponential backoff and `loadHistory` reconciliation

- **Audit ID:** Tier 1.14, Tier 3.30
- **File:** `frontend/src/hooks/useEventStream.jsx:75-137`
- **Current:** Reconnect timer is `setTimeout(connect, 2000)` unconditionally, forever. No backoff, no jitter, no cap. Reconnect does not call `loadHistory()` so events published during the gap are lost from the dashboard.
- **Why a developer cares:** The "Stream live" chip turns green after a 2-second outage and the user assumes continuity. Events that arrived during the gap are in the database but never shown.
- **Fix:**
  1. Add a `reconnectAttempt` ref, start at 0, reset on `onopen`.
  2. Compute `delay = min(2000 * 2 ** reconnectAttempt, 30000) + random(0, 1000)` (1s jitter).
  3. On `socket.onopen`, call `loadHistory()` (already exists) *after* the socket opens, so any messages that the server replayed into the open socket are merged with the REST snapshot by id.
  4. After 10 consecutive failures, surface a non-retrying "Stream offline — click to reconnect" UI state.
- **Why a developer cares:** Bug directly produces "I sent a webhook and it's not showing up." Cures the perception that the dashboard is frozen.
- **Verification:** Manual: `docker compose stop api`; dashboard shows "Reconnecting…" with a slow pulse. After ~30s, show "Stream offline." `docker compose start api`; click reconnect, history rehydrates, new event arrives.

### Task 2.3 — `loadHistory` × WebSocket race: one composite effect, `AbortController`, gated WS open

- **Audit ID:** Tier 1.15
- **File:** `frontend/src/hooks/useEventStream.jsx:42-73, 96-108`
- **Current:** `loadHistory` is in flight while the WebSocket is opening. Live events arriving first can be overwritten by the historical snapshot, and vice versa.
- **Fix:** Refactor the effect into a single async setup that:
  1. Calls `loadHistory(signal)` and `await`s it (with `AbortController.signal`).
  2. Only then opens the WebSocket.
  3. WS `onmessage` only appends events whose `id` is not in the current `events` array.
  4. Switching `sessionId` aborts the in-flight history load and the open WebSocket.
- **Verification:** Manual: send a webhook while the page is loading. Event appears once, no duplicate, no skip.

### Task 2.4 — Bound Redis pubsub and `aclose()` in WebSocket handler

- **Audit ID:** Tier 4.3, Tier 4.15, Tier 4.16
- **File:** `backend/app/main.py:309-344`
- **Fix:**
  1. Wrap `forward_to_browser` body in `try/except (redis.exceptions.RedisError, RuntimeError)` and on exception: `logger.warning(...)`, then break the loop. The `wait_for_disconnect` task will end cleanly when the client closes.
  2. Wrap `pubsub.aclose()` in `asyncio.wait_for(..., timeout=2.0)`; log on timeout.
  3. Add a server-side heartbeat: every 25s, send `{"type": "ping"}` over the WebSocket. Client `onmessage` no-ops on `{type: 'ping'}`.
  4. Bound the queue implicitly: switch from `pubsub.listen()` to `pubsub.get_message(timeout=0.05)` in a `while True` loop with `await asyncio.sleep(0)`. Document the change.
- **Verification:** Manual: kill the Redis container, observe WebSocket closes cleanly with a `RedisError` log line, client reconnects. Run for an hour with heartbeat on — connection survives NAT timeouts.

### Task 2.5 — Persist a `forward_delivery_status` enum on the row, drop the "always show green on 200" lie

- **Audit ID:** Tier 1.18, Tier 4.12
- **Files:** `backend/app/main.py:107-134`, `forwarding_diagnostics.py`, `event_serialization.py`
- **Current:** `forward_error` is a string column. `forwarding_diagnostics.py` collapses any non-empty `forward_error` into `delivery_failure` and never distinguishes timeout from connection-refused.
- **Fix:**
  1. Change `forward_webhook` to return a fourth tuple element: `forward_failure_kind: Optional[str]` where the value is one of `timeout`, `connection`, `tls`, `dns`, `invalid_url`, `other`. Set it explicitly per exception class (`httpx.ConnectError → "connection"`, `httpx.ReadTimeout → "timeout"`, `ssl.SSLError → "tls"`, `socket.gaierror → "dns"`).
  2. Persist `forward_failure_kind` as a new column (extend `ensure_session_config_columns` to also `ADD COLUMN IF NOT EXISTS forward_failure_kind VARCHAR(32)` on `webhook_events`). Idempotent, same pattern.
  3. In `build_forward_diagnostics`, return the kind in the message: e.g. `"Local handler timed out after 10s. Check the local process."`.
  4. Frontend inspector shows the kind in a new pill.
- **Why a developer cares:** Today a connect-refused, a TLS handshake failure, a 10s timeout, and a misconfigured `InvalidURL` all produce the same dashboard pill. The developer cannot tell which.
- **Verification:** New unit tests in `test_forwarding_diagnostics.py` for each exception class. `python -m unittest discover -s backend\tests -p test_*.py` passes 35+ tests.

### Task 2.6 — Reject bodies above a configurable size limit

- **Audit ID:** Tier 1.8
- **File:** `backend/app/main.py:141-194`
- **Fix:** Read `MAX_INGEST_BODY_BYTES` from env (default `5_242_880` = 5 MB). If `int(request.headers.get("content-length", 0)) > MAX_INGEST_BODY_BYTES`, return `413 {"detail": "Body too large"}`. Also cap the streaming read by replacing `await request.body()` with a manual loop that raises on overflow. Document the limit in the env example.
- **Why a developer cares:** A malicious or chatty sender (or a misconfigured one) can fill the developer's disk silently. No log line, no metric, no admin endpoint.
- **Verification:** New test `test_receive_webhook_rejects_oversized_body`. Manual: `curl --data-binary "@/tmp/100MB" http://localhost/api/hooks/test` returns 413.

### Task 2.7 — `localStorage` quota exceeded surfaces to the user

- **Audit ID:** Tier 1.16
- **File:** `frontend/src/hooks/useEndpointState.jsx:21-23, 56-77, 96-114`
- **Fix:**
  1. Wrap `localStorage.setItem` in `try/catch`. On `QuotaExceededError`, set a `storageError` state.
  2. Move the persistence side effect out of the state updater and into a `useEffect([history])` and `useEffect([labels])` so it is render-phase-safe.
  3. Render a `StatusBanner` warning: "Local browser storage is full. Endpoint labels and history are not being saved."
- **Verification:** Manual: fill `localStorage` to the cap; create a new endpoint; observe the banner.

### Task 2.8 — `getForwardBadge` uses the new `forward_delivery_status` consistently

- **Audit ID:** already partially addressed by Phase 6 plan; my audit noted that the frontend had `forward_delivery_status` but did not always thread the message through. The Phase 6 plan's Task 3 is the right fix; re-verify.
- **Action:** No new code. Re-run Phase 6 test plan; confirm `forward_delivery_message` appears in the inspector.

---

## 6. Tier 2: Make The Developer Machine Work

These are the dev-machine ergonomics. The cleanup audit explicitly listed the host/Docker gap and the placeholder as items. Most of these are quick.

### Task 3.1 — Default port 80 → 8080 in `docker-compose.yml`, document the override

- **Audit ID:** Tier 1.4
- **File:** `docker-compose.yml:25`
- **Fix:** Change to `127.0.0.1:8080:80`. Update `.env.example` to mention the `LOCAL_INGRESS_PORT` env override. Update `frontend/src/components/SetupRail.jsx:117` placeholder to use 8080. (The 127.0.0.1 vs 0.0.0.0 question is orthogonal; see Task 3.5.)
- **Why a developer cares:** Port 80 is taken on most dev machines (IIS, Apache, Skype legacy, dozens of dev tools). A cryptic nginx error is the developer's first impression.
- **Verification:** `docker compose up`, then `curl http://localhost:8080/` returns 200.

### Task 3.2 — Document and warn on `host.docker.internal`

- **Audit ID:** Tier 1.5
- **File:** `frontend/src/components/SetupRail.jsx:117`; `backend/app/main.py` (config save route)
- **Fix:**
  1. Replace the placeholder with explicit copy: "If your local app runs outside Docker, use the host's LAN IP (e.g. `http://192.168.1.42:3000/webhooks/razorpay`). `host.docker.internal` only resolves on Docker Desktop or Docker Engine 20.10+."
  2. On `PUT /sessions/{id}/config` in the backend, if the URL host is `host.docker.internal`, add a `forward_url_warnings: ["..."]` field to the response. (The new SSRF validator from Task 1.3 already allows it; this just adds a heads-up.)
  3. Frontend renders the warning under the forward URL input.
- **Why a developer cares:** On plain Linux, the developer follows the placeholder, sets it, and gets "Delivery failure" with no hint.
- **Verification:** Manual: set `forward_url=http://host.docker.internal:3000/...`, observe the inline warning.

### Task 3.3 — `frontend/Dockerfile` uses lockfile and `npm ci`

- **Audit ID:** Tier 0.5
- **File:** `frontend/Dockerfile:1-6`
- **Fix:**
  ```dockerfile
  FROM node:20-alpine
  WORKDIR /app
  COPY package.json package-lock.json ./
  RUN npm ci
  COPY . .
  CMD ["npm", "run", "dev"]
  ```
  Note: `package-lock.json` already exists and is tracked (44 KB), per the audit's verification.
- **Why a developer cares:** Every container restart re-resolves the `^` ranges and pulls a fresh `vite`/`react`. Supply-chain and reproducibility hazard.
- **Verification:** `docker compose build frontend` succeeds. The first `RUN npm ci` line in the build log shows a clean lockfile install.

### Task 3.4 — Pin `:latest` tags

- **Audit ID:** Tier 0.6
- **Files:** `tunnel/Dockerfile:1`, `docker-compose.yml:23, 35`
- **Fix:**
  - `tunnel/Dockerfile`: `FROM cloudflare/cloudflared:2024.12.2 AS cloudflared` (or the latest verified version; pin in `.env.example` with a comment that it's reviewed quarterly by Dependabot).
  - `docker-compose.yml`: `image: nginx:1.27-alpine` for both `local_ingress` and `public_ingress`.
  - Postgres and Redis are already major-pinned (`postgres:15-alpine`, `redis:7-alpine`); leave them.
- **Why a developer cares:** A yanked `cloudflared:latest` or `nginx:alpine` quietly breaks a long-running install.
- **Verification:** `docker compose config` shows the pinned versions. `docker compose pull` does not change the pinned tags.

### Task 3.5 — Vite dev server binds to 127.0.0.1, not 0.0.0.0

- **Audit ID:** Tier 1.7
- **File:** `frontend/package.json:5`
- **Fix:** Change `"dev": "vite --host 127.0.0.1 --port 5173"`. Document the override (e.g. `--host 0.0.0.0` for LAN testing) in the comment.
- **Why a developer cares:** Coffee-shop Wi-Fi, public networks, and dev containers on shared hosts all see the dev server on `0.0.0.0:5173`, including source maps and the unauthenticated dev API proxy.
- **Verification:** `lsof -i :5173` shows 127.0.0.1 only.

### Task 3.6 — Add a top-level `VITE_API_BASE` env hook

- **Audit ID:** Tier 3.11
- **File:** `frontend/src/App.jsx:20-26`; new file `frontend/.env.example`
- **Fix:** Read `import.meta.env.VITE_API_BASE` first; fall back to the existing `window.location` heuristic. Add `frontend/.env.example` with `VITE_API_BASE=` (commented) so the variable is discoverable.
- **Why a developer cares:** Dev server on a different port or a multi-origin deploy breaks the magic-number heuristic silently.
- **Verification:** Set `VITE_API_BASE=http://localhost:8000`; `npm run dev`; `fetch('/api/sessions')` hits `http://localhost:8000/api/sessions`.

### Task 3.7 — Tunnel script fails fast on misconfigured env

- **Audit ID:** Tier 1.10, Tier 2.3
- **File:** `tunnel/start.sh:3-13`
- **Fix:**
  1. If `CLOUDFLARE_TUNNEL_TOKEN` is non-empty **and** `TUNNEL_HOSTNAME` is empty, fail with `echo "ERROR: CLOUDFLARE_TUNNEL_TOKEN is set but TUNNEL_HOSTNAME is empty. Set both or neither." >&2; exit 1`.
  2. If `CLOUDFLARE_TUNNEL_TOKEN` is empty **and** `TUNNEL_HOSTNAME` is non-empty, warn (quick-tunnel mode will generate a different URL) and continue.
  3. Bump the URL-discovery loop from 30s to 120s.
  4. On timeout, write `/shared/tunnel_status.txt` with `{"status": "starting", "message": "..."}` so the backend can return a structured response instead of `null`.
- **Why a developer cares:** The 30s timeout on slow networks silently fails. The hostname/token mismatch silently overrides the developer's intent.
- **Verification:** Manual: set `CLOUDFLARE_TUNNEL_TOKEN=fake` and `TUNNEL_HOSTNAME=`, start stack, see error and exit 1. Set `TUNNEL_HOSTNAME=foo.example.com` only, start stack, see warning, quick-tunnel URL appears.

### Task 3.8 — Name the `docker volume`s explicitly

- **Audit ID:** Tier 2.4
- **File:** `docker-compose.yml:92-94`
- **Fix:**
  ```yaml
  volumes:
    postgres_data:
      name: hookrelay_postgres_data
    tunnel_data:
      name: hookrelay_tunnel_data
  ```
- **Why a developer cares:** `docker volume prune` and `docker compose down -v` are different beasts. Named volumes survive `prune` (which the dev probably wants for "clean up orphans") but `down -v` still wipes them (which they should know about).
- **Verification:** `docker volume ls` shows `hookrelay_postgres_data`. `docker compose down` does not remove it. `docker compose down -v` does.

### Task 3.9 — Add a `docker compose logs` friendly default and a one-line healthcheck

- **Audit ID:** Tier 4.8
- **File:** `backend/app/main.py:445-454` (`health` endpoint)
- **Fix:** Expand `health` to actually check the things:
  ```python
  @local_control_router.get("/health")
  def health(db: Session = Depends(get_db)):
      db_ok = redis_ok = tunnel_ok = False
      try:
          db.execute(text("SELECT 1"))
          db_ok = True
      except Exception:
          pass
      try:
          # Use a sync wrapper around the existing redis client for ping.
          ...
      except Exception:
          pass
      tunnel_url = read_tunnel_url_file()
      tunnel_ok = tunnel_url is not None
      return {
          "status": "ok" if (db_ok and redis_ok) else "degraded",
          "postgres": db_ok,
          "redis": redis_ok,
          "tunnel_url_present": tunnel_ok,
      }
  ```
  Add a `Makefile` target `make health` that curls `http://localhost:8080/api/health`.
- **Why a developer cares:** When something is wrong, the developer's first question is "what's broken?" A flat `{"status": "ok"}` answers nothing.
- **Verification:** `make health` returns the full breakdown. Stop Redis, `make health` shows `redis: false, status: degraded`.

---

## 7. Tier 3: OSS Contributor Story

These are the items the new contributor hits on day 1 of a PR.

### Task 4.1 — Frontend `build` and `lint` scripts

- **Audit ID:** Tier 0.4, Tier 0.5, Tier 3.13
- **File:** `frontend/package.json`
- **Fix:** Add:
  ```json
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext .js,.jsx --max-warnings 0",
    "test": "vitest run"
  }
  ```
- **Verification:** `cd frontend && npm run build` produces a production bundle. `npm run lint` runs ESLint (after Task 4.2 adds config).

### Task 4.2 — Add ESLint and Prettier

- **Audit ID:** Tier 0.4
- **New files:** `frontend/.eslintrc.cjs`, `frontend/.prettierrc.json`, `frontend/.eslintignore`
- **Deps:** `eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `prettier` as devDependencies.
- **Rules:** Default React + hooks rules. No `console.log` allowed (matches the project rule). `react-hooks/exhaustive-deps: error`. Allow `console.error` and `console.warn`.
- **Why a developer cares:** Without a linter, every PR is a style negotiation.
- **Verification:** `npm run lint` is clean on the current code. CI runs `lint`.

### Task 4.3 — Add frontend tests with `vitest`

- **Audit ID:** Tier 3.13
- **New files:** `frontend/vitest.config.js`, `frontend/src/hooks/__tests__/useEventStream.test.jsx`, `frontend/src/hooks/__tests__/useEndpointState.test.jsx`, `frontend/src/__tests__/ui.test.js`, `frontend/src/components/__tests__/ConfirmDialog.test.jsx`
- **Deps:** `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `happy-dom` (or `jsdom`).
- **Tests to write (at minimum):**
  - `useEventStream` — loadHistory + WS race (Task 2.3), reconnect backoff, session switch cancellation.
  - `useEndpointState` — `readStorage`/`writeStorage` quota exceeded, label save, summary poll failure.
  - `prettyPrintBody` — XSS-safe rendering of `<script>` and `&`.
  - `formatRelative` — `NaN` → "Unknown", valid timestamps render.
  - `ConfirmDialog` — Escape closes, focus trap, type-to-confirm (after Task 4.4).
  - `getForwardBadge` — exhaustive table of status → label.
- **Why a developer cares:** The two riskiest files in the app have zero tests today. Once the race conditions are fixed (Task 2.3, Task 2.2), tests lock them in.
- **Verification:** `npm test` runs all suites green. CI runs `test` and `lint`.

### Task 4.4 — `ConfirmDialog` accessibility and "type to confirm" for destructive ops

- **Audit ID:** Tier 3.5, Tier 3.6
- **File:** `frontend/src/components/ConfirmDialog.jsx`
- **Fix:**
  1. Add `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the title h2.
  2. Add `onKeyDown` for `Escape` → `onClose()`.
  3. Initial focus moves to the **safe** (Cancel) button on open.
  4. Trap focus inside the dialog with a small custom trap (or use the native `<dialog>` element with `showModal()`).
  5. When `kind === 'delete-endpoint'`, render a text input that requires the endpoint id to be typed before the confirm button enables.
  6. When `disabled` is true (delete in flight), make the backdrop click a no-op.
- **Why a developer cares:** A single click on "Delete endpoint" wipes the session and every captured event. The current dialog says "this cannot be undone" but doesn't enforce it. A11y is a 30-line change.
- **Verification:** New tests in `ConfirmDialog.test.jsx`. Manual with keyboard-only navigation.

### Task 4.5 — `LICENSE` attribution, `README` license badge accuracy, `CHANGELOG.md`

- **Audit ID:** Tier 0.1, Tier 0.2
- **Fix:** After Task 0.1 lands, add `CHANGELOG.md` with a "1.0.0 — 2026-06-XX" entry listing the shipped features (Razorpay mode, public tunnel ingest, local forwarding, replay, fixtures, multi-stage) and the new hardening items. Document the change in `CHANGELOG.md` so the next maintainer has a one-page history.
- **Verification:** `CHANGELOG.md` exists, links to the staged plans.

---

## 8. Tier 4: Scale And Operate

These are the items that don't bite day 1 but bite at month 6.

### Task 5.1 — Cap `get_webhooks` with pagination

- **Audit ID:** Tier 1.12, Tier 4.4
- **File:** `backend/app/main.py:200-209`
- **Fix:** Add `?limit=100&before_id=...` to `GET /hooks/{session_id}`. Default 100, max 500. Sort by `received_at DESC, id DESC`. The frontend's `loadHistory` uses the same query.
- **Why a developer cares:** A long-running tunnel install can produce thousands of events. The dashboard's initial load serializes them all into JSON.
- **Verification:** New test: capture 200 events, GET with `?limit=50&before_id=...` returns 50.

### Task 5.2 — Dedupe duplicate detection in SQL

- **Audit ID:** Tier 1.11
- **File:** `backend/app/event_serialization.py:63-84` (`find_duplicate_razorpay_event_id`); called from `main.py:166` and again at `main.py:188`
- **Fix:** Replace the in-Python loop with a single SQL query:
  ```python
  duplicate_id = (
      db.query(models.WebhookEvent.id)
      .filter(
          models.WebhookEvent.session_id == event.session_id,
          models.WebhookEvent.id < event.id,
          models.WebhookEvent.headers[RAZORPAY_EVENT_ID_HEADER].astext == provider_event_id,
      )
      .order_by(models.WebhookEvent.id.asc())
      .limit(1)
      .scalar()
  )
  ```
  Add a btree functional index migration (extend `ensure_session_config_columns` with `CREATE INDEX IF NOT EXISTS idx_webhook_events_razorpay_event_id ON webhook_events ((headers ->> 'x-razorpay-event-id')) WHERE headers ? 'x-razorpay-event-id'`). Also stop calling the helper twice in `receive_webhook` — compute once after the first commit, stash on the in-memory event, reuse on the second publish.
- **Why a developer cares:** O(N) full scan per webhook turns the live workbench into a slideshow at 1000+ events. Doubled on every request.
- **Verification:** Existing `test_duplicate_detection_across_two_razorpay_captures` still passes. New perf test: capture 1000 events, post a duplicate, the duplicate detection query plan is `Index Scan` (check `EXPLAIN` in the Postgres-only path).

### Task 5.3 — Switch to async SQLAlchemy

- **Audit ID:** Tier 1.10
- **File:** `backend/app/database.py`; `backend/app/main.py`
- **Fix:** Switch engine to `create_async_engine(DATABASE_URL)` with `postgresql+asyncpg://...` driver. Replace `Session` with `AsyncSession` everywhere. Wrap `db.commit()`/`db.refresh()` in `await`. Update `get_db` to yield an `AsyncSession` and `await session.close()` on cleanup. Update the test fixture in `test_api_smoke.py` to use `httpx.AsyncClient(transport=ASGITransport(app=app))` and `pytest-asyncio`.
- **Why a developer cares:** Under any non-trivial webhook rate (Razorpay burst, GitHub CI push, a chatty Stripe test account), the sync session blocks the event loop. Throughput collapses.
- **Verification:** New `pytest-asyncio` test that fires 50 concurrent webhooks and asserts the median latency does not exceed the per-request baseline by more than 2x.

### Task 5.4 — Adopt Alembic

- **Audit ID:** Tier 1.10, Tier 4.1
- **Files:** New `backend/alembic/` directory, `alembic.ini`, `env.py`
- **Fix:**
  1. `pip install alembic` (add to `backend/requirements.txt`).
  2. `alembic init backend/alembic`.
  3. Generate an initial migration that captures the current schema (`alembic revision --autogenerate -m "initial"`).
  4. Replace `Base.metadata.create_all(bind=engine)` in `main.py:22` with an `alembic upgrade head` step in the compose file (or a small entrypoint script).
  5. Keep `ensure_session_config_columns` for backward compat with existing dev installs (it is idempotent and a no-op on Alembic-managed DBs), or document a one-time migration from the legacy DB to Alembic.
- **Why a developer cares:** `ADD COLUMN IF NOT EXISTS` does not handle renames, type changes, or index changes. The moment a third column is needed, this is a maintenance liability.
- **Verification:** A fresh `docker compose up` on a clean volume runs `alembic upgrade head` and ends in a working state. Existing volume is migrated by `alembic upgrade head` (idempotent because the column already exists).

### Task 5.5 — Add structured logging

- **Audit ID:** Tier 1.17
- **File:** `backend/app/main.py` (and helpers)
- **Fix:**
  1. Add `import logging` and `logger = logging.getLogger("hookrelay")` at module top.
  2. Configure root logging in the `lifespan` startup: `logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(name)s %(message)s')`.
  3. Add `logger.info("webhook received", extra={"session_id": sid, "event_id": event.id})` in `receive_webhook`.
  4. Add `logger.exception("forward_webhook failed", extra={"session_id": sid, "url": forward_url})` in the exception branch.
  5. Add `logger.warning("redis publish failed", extra={"session_id": sid})` in the WebSocket pubsub error branch.
  6. Add `logger.warning("ensure_session_config_columns failed", extra={"statement": sql})` per-statement.
- **Why a developer cares:** Zero `logger.*` calls means every silent failure is a developer's hour of debugging. Logging is the difference between "I cannot tell why this broke" and "I see line 183 raised `ConnectError` for `host.docker.internal:3000`."
- **Verification:** `docker compose logs api` shows the new log lines during a webhook capture.

### Task 5.6 — `forward_webhook` with split timeouts, optional fire-and-forget

- **Audit ID:** Tier 4.4
- **File:** `backend/app/main.py:107-134`
- **Fix:**
  1. Change `timeout=10.0` to `httpx.Timeout(connect=2.0, read=5.0, write=5.0, pool=1.0)`.
  2. Add an env flag `FORWARD_FIRE_AND_FORGET=1` that wraps the forward in `asyncio.create_task(...)` so `receive_webhook` returns 200 to the public ingress immediately. Default off (preserve current behavior).
  3. In fire-and-forget mode, log the result and publish to Redis; do not block the public response.
- **Why a developer cares:** A developer's local app is down (TCP RST) and the public request stalls for 10s. Razorpay may interpret that as a failure and retry. 2s connect + 5s read is the right default; fire-and-forget is the right knob.
- **Verification:** New test: with `FORWARD_FIRE_AND_FORGET=1`, `receive_webhook` returns in < 100ms even with a down local app. The WebSocket still receives the forward result asynchronously.

### Task 5.7 — Replay audit visibility — mark replay rows as `REPLAY` and show in the timeline

- **Audit ID:** Tier 4.14, Tier 1.13
- **File:** already partially done — `main.py:241-294` creates `method="REPLAY"`. The frontend's `EventList` already shows a `Replay` pill. Verify and add: a `replay_target_event_id` column so a replay event links back to the original. (Alternative: parse from the body or headers. Column is cleaner.)
- **Why a developer cares:** A developer who replays an event 5 times during debugging sees 5 rows in the timeline. Today they cannot tell which replay is which without inspecting the body.
- **Verification:** Replay an event; the new row has `replay_target_event_id = <original>`. The inspector shows "Replay of Event #42".

### Task 5.8 — Retention: `DELETE /admin/cleanup?older_than=7d`

- **Audit ID:** Tier 1.9
- **File:** new `backend/app/cleanup.py`, registered on `local_control_router`
- **Fix:**
  1. New route `POST /admin/cleanup` accepting `{"older_than": "7d", "session_id": "..."}` (optional, default all).
  2. Parses the duration with `re` and `timedelta`. Returns `{"deleted_events": N, "deleted_configs": M}`.
  3. Requires the ingest token (Task 1.2).
- **Why a developer cares:** Long-running installs store every event forever. Today the developer has no admin path; `GET /api/hooks/{id}` gets slower as the table grows.
- **Verification:** New test: insert 3 events at `t-8d`, call cleanup with `older_than=7d`, assert 3 events gone, the rest stay.

### Task 5.9 — Move `uvicorn --reload` to a dev override

- **Audit ID:** Tier 0.7
- **File:** `backend/Dockerfile`, new `docker-compose.dev.yml`
- **Fix:**
  1. In `backend/Dockerfile`, change `CMD` to `["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` (no `--reload`).
  2. Add `docker-compose.dev.yml` that overrides the `api` service command with `--reload`.
  3. Document `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` for dev mode.
- **Why a developer cares:** The default Dockerfile runs `--reload` even in "production" copies. Watchdog process, bind-mounted source, all the surprises.
- **Verification:** `docker compose up --build` runs without `--reload`. `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` does.

### Task 5.10 — `formatRelative` "NaN" guard, no-static-time rendering

- **Audit ID:** Tier 3.7, Tier 3.8
- **File:** `frontend/src/ui.js:41-56`
- **Fix:**
  1. Validate `Date.parse(value)` returns a number; if not, return "Unknown time."
  2. Add a `useNowTick(intervalMs)` hook that returns a state value bumped on an interval. `App.jsx` uses it with `30000` to re-render relative-time labels every 30s.
- **Why a developer cares:** "5s ago" stays "5s ago" until something triggers a re-render. `NaNd ago` is a real bug when timestamps are missing or malformed.
- **Verification:** New test in `ui.test.js`.

---

## 9. Verification, In Order

Each tier is gated by a command set. The whole plan is verified by the existing E2E test report's "Final Verification Before Redesign" plus the new tests added by each task.

### After Tier 0

```powershell
git -C C:\Users\visha\hookrelay diff --check
head -1 C:\Users\visha\hookrelay\LICENSE
```

### After Tier 1 (Security)

```powershell
cd C:\Users\visha\hookrelay\backend
python -m unittest discover -s tests -p test_*.py
# Expected: 35+ tests pass, including the new signature-rejection and auth tests.
```

Manual:
- `curl -H "X-Razorpay-Event-Id: x" -d '{"event":"payment.captured"}' http://localhost:8080/api/hooks/test` → 401 (with secret configured).
- `curl http://localhost:8080/api/sessions` without `Authorization` → 401.

### After Tier 1.5 (Stop Lying)

```powershell
cd C:\Users\visha\hookrelay\backend
python -m unittest discover -s tests -p test_*.py
```

Manual: kill Redis, observe WebSocket closes cleanly with a log line, reconnects with backoff.

### After Tier 2 (Dev Machine)

```powershell
docker compose config  # verify no defaults
docker compose up --build
curl http://localhost:8080/api/health  # full breakdown
```

### After Tier 3 (OSS)

```powershell
cd C:\Users\visha\hookrelay\frontend
npm ci
npm run lint
npm run build
npm test
```

### After Tier 4 (Scale)

```powershell
cd C:\Users\visha\hookrelay\backend
alembic upgrade head
python -m unittest discover -s tests -p test_*.py
```

---

## 10. What This Plan Does Not Cover (Explicitly)

The following are out of scope by design, in line with the project's own constraints:

- **Multi-provider framework.** The audit noted that adding a Stripe handler would be straightforward, but the project's roadmap explicitly says "avoid abstractions until a second provider is actually planned." We honor that.
- **Hosted SaaS mode.** Explicitly excluded.
- **Retry engine / queue.** A forwarded webhook that fails 5 times is out of scope. The developer can replay manually.
- **UI redesign.** The cleanup audit's "event-first UI" is its own follow-up plan, not part of this hardening pass.
- **Replacing the migration story with a deep one.** Alembic is a 2-hour PR; more elaborate tooling (e.g. `dbmate`, `sqlx`) is not warranted at this scale.
- **Frontend `App.jsx` decomposition.** Genuine 1500-line file, but splitting it is its own multi-PR effort. The Tier 3 testing work (Task 4.3) reduces the risk of doing that decomposition later.
- **Production deployment story.** The `docker-compose.prod.yml` and `Caddy/Nginx` example are deferred. Self-hosters on a VPS will fork and figure it out, same as today.

---

## 11. Risk Register

The biggest risks to executing this plan, and how the plan addresses them:

| Risk | Mitigation |
|---|---|
| Tier 1 (security) breaks the public webhook path. | All security changes have explicit tests; the existing 31 tests act as a regression net. The signature-rejection change is opt-out for `missing_secret`, preserving the existing dev flow. |
| Tier 1.2 (auth token) breaks the frontend. | Frontend already uses `Authorization`-style semantics for nothing today; adding `localStorage`-stored token + `Authorization: Bearer` header is a contained change. The frontend's API call wrappers are two functions. |
| Tier 4.3 (async SQLAlchemy) breaks the test suite. | The audit's task 5.3 includes updating the test fixture in `test_api_smoke.py` to use `httpx.AsyncClient`. Run the suite mid-refactor. |
| Frontend test introduction (Tier 4.3 in this plan, Task 4.3 above) becomes a 2-day rabbit hole. | Keep the test surface narrow: race conditions, storage failure paths, XSS safety, formatRelative/forwardBadge tables. Skip the snapshot-test avalanche. |
| Dev-machine behavior varies (Windows, Mac, Linux). | The plan is tested against the project's existing dev workflow (Docker Compose, port 8080). Mac and Windows differences are documented; Linux-on-non-Desktop is documented in the `host.docker.internal` warning (Task 3.2). |

---

## 12. File Map Summary

Files added by this plan (across all tiers):

- `.github/CODE_OF_CONDUCT.md`
- `.github/SECURITY.md`
- `.github/CONTRIBUTING.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/ISSUE_TEMPLATE/bug.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `Makefile`
- `frontend/.eslintrc.cjs`
- `frontend/.prettierrc.json`
- `frontend/.env.example`
- `frontend/vitest.config.js`
- `frontend/src/hooks/__tests__/useEventStream.test.jsx`
- `frontend/src/hooks/__tests__/useEndpointState.test.jsx`
- `frontend/src/__tests__/ui.test.js`
- `frontend/src/components/__tests__/ConfirmDialog.test.jsx`
- `backend/alembic.ini`
- `backend/alembic/env.py`
- `backend/alembic/versions/<initial>.py`
- `backend/app/cleanup.py`
- `backend/tests/test_cleanup.py`
- `CHANGELOG.md`

Files modified by this plan:

- `LICENSE` (conflict resolution)
- `.gitignore` (duplicate `tunnel_url.txt` removal)
- `docker-compose.yml` (defaults, version pins, named volumes, port 8080, `GITHUB_WEBHOOK_*` already removed)
- `docker-compose.dev.yml` (new)
- `nginx/public.conf` (already shipped)
- `tunnel/start.sh` (fail-fast, longer timeout, status file)
- `frontend/Dockerfile` (lockfile copy, `npm ci`)
- `tunnel/Dockerfile` (version pin)
- `frontend/package.json` (scripts, `vite` host, devDeps)
- `frontend/src/App.jsx` (relative-time tick, `VITE_API_BASE` env, `useCallback` for handlers)
- `frontend/src/hooks/useEventStream.jsx` (abort controller, backoff, reconciliation)
- `frontend/src/hooks/useEndpointState.jsx` (quota error handling, effect-based persistence)
- `frontend/src/components/ConfirmDialog.jsx` (a11y, type-to-confirm)
- `frontend/src/components/SetupRail.jsx` (placeholder copy, warning surfacing)
- `frontend/src/ui.js` (NaN guard, copy-failure messaging)
- `backend/app/main.py` (signature enforcement, auth dep, SSRF validation, structured logs, split timeouts, fire-and-forget, body size cap, structured forward failure, replay 502, async DB)
- `backend/app/database.py` (async engine)
- `backend/app/models.py` (new columns)
- `backend/app/schemas.py` (response model updates, `HttpUrl` constraint)
- `backend/app/event_serialization.py` (SQL dedupe, signature boolean, `is_signature_acceptable`)
- `backend/app/forwarding_diagnostics.py` (kind field)
- `backend/tests/test_api_smoke.py` (new test cases)

No file is in more than two tasks. Most are in one.

---

## 13. Done When

This plan is complete when, after merging all the above:

- `make test` runs the backend suite from the repo root and passes.
- `npm test` runs the frontend suite and passes.
- `npm run lint` is clean.
- `npm run build` produces a production bundle.
- `docker compose up` (no `-v`) starts cleanly with `.env` populated.
- `make health` returns `status: ok, postgres: true, redis: true, tunnel_url_present: true`.
- A `curl` to the public tunnel URL with a forged body returns 401 (when a Razorpay secret is configured).
- A `curl` to `/api/sessions` without `Authorization` returns 401.
- A replay that fails forwarding returns 502 and the UI shows a red pill, not green.
- The dashboard reconnects after a backend restart, backfills any missed events, and the user sees a continuous timeline.
- A first-time contributor can clone, `cp .env.example .env`, `make dev`, `make test`, and have a working environment in under 10 minutes.
- A first-time contributor who opens a PR sees CI run three jobs (backend, frontend build, frontend lint) and a Dependabot weekly ping.
- `LICENSE` starts with `MIT License` and ends with the standard MIT tail.
- No `<<<<<<< HEAD` markers, no `console.log` in production code, no `:latest` tags in production-shaped Dockerfiles.

The plan that lives in `docs/superpowers/plans/` is the project's own road. This plan is the next four weeks of work that road implies, expressed as tasks a contributor can pick up one at a time.
