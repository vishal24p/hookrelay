# HookRelay End-To-End Test Plan Before Redesign

## Purpose

Test the current HookRelay app from backend helpers through browser behavior before implementing a new UI design.

The goal is not to polish the UI yet. The goal is to find broken flows, environment blockers, and missing coverage so the redesign does not hide product bugs.

## Scope

- Backend unit tests for Razorpay metadata, duplicates, fixtures, forwarding, and replay payload helpers.
- Backend API smoke tests for sessions, config, tunnel URL, hook capture, clear, replay, and fixture generation.
- Frontend build and browser smoke tests for the current app.
- One full local flow: configure Razorpay, send fixture, inspect event, replay event, clear feed.
- Environment errors that may block local testing.

## Out Of Scope

- No redesign implementation.
- No visual restyling.
- No new provider abstraction.
- No production deployment testing.
- No real Razorpay account testing until the local path is clean.

## Assumptions

- Current app runs with FastAPI backend, Vite frontend, Postgres, Redis, and optional Cloudflare tunnel from `docker-compose.yml`.
- Backend defaults use Docker service hostnames: `postgres` and `redis`.
- Running backend directly on the host will need explicit local `DATABASE_URL` and `REDIS_URL`.
- Existing frontend dependency install may be missing because `frontend-dev.err.log` currently shows `vite` is not recognized.
- Docker may be unavailable on this machine until Docker Desktop is running.

## Test Order

### 1. Baseline Worktree Check

Commands:

```powershell
git status --short
```

Success:

- We know which files are already dirty before testing.
- Any test artifacts created later are easy to separate from existing work.

Likely errors:

- None expected.
- Risk: dirty files are already present, so do not treat the status output as a test failure by itself.

### 2. Dependency And Environment Check

Commands:

```powershell
Test-Path frontend\node_modules\.bin\vite.cmd
Test-Path backend\requirements.txt
docker compose ps
```

Success:

- Vite binary exists.
- Backend requirements file exists.
- Docker can talk to Docker Desktop.

Likely errors:

- `vite is not recognized as an internal or external command` if frontend dependencies are not installed.
- Docker pipe or daemon error if Docker Desktop is not running.
- Backend direct run may fail with database or Redis host errors because default hostnames are Docker-only.

Decision:

- If Vite is missing, run `npm install` inside `frontend`.
- If Docker is unavailable, either start Docker Desktop or run backend with local database and Redis URLs.

### 3. Backend Unit Tests

Commands:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
```

Success:

- Existing helper-level behavior passes.
- Razorpay fixture catalog and signature generation still work.
- Razorpay metadata extraction still returns expected IDs.
- Duplicate detection still matches previous event IDs case-insensitively.
- Forwarding and replay diagnostics still classify delivery states correctly.

Likely errors:

- `ModuleNotFoundError` if Python dependencies are not installed.
- Import failure if the working directory is wrong.
- Test failure if a helper changed fixture keys, diagnostic labels, or metadata fields without updating tests.

### 4. Backend App Startup

Preferred command:

```powershell
docker compose up --build
```

Alternative host-run command only if database and Redis URLs are set:

```powershell
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Success:

- Backend starts.
- Tables are created.
- Redis pub/sub connection is available.
- `/health` responds.

Likely errors:

- Docker unavailable if Docker Desktop is stopped.
- `psycopg2.OperationalError` when backend cannot reach Postgres.
- Redis connection errors if `REDIS_URL` points to `redis` outside Docker.
- Port conflict on `8000`.

### 5. Backend API Smoke Tests

Use one test endpoint id, for example `test-e2e-razorpay`.

Checks:

- `GET /health`
- `GET /api/tunnel-url`
- `GET /api/sessions`
- `GET /api/sessions/test-e2e-razorpay/config`
- `PUT /api/sessions/test-e2e-razorpay/config` with provider `razorpay`, secret, and forward URL.
- `POST /api/sessions/test-e2e-razorpay/razorpay-fixtures/payment_captured`
- `POST /api/hooks/test-e2e-razorpay` with generated fixture body and headers.
- `GET /api/hooks/test-e2e-razorpay`
- `POST /api/hooks/test-e2e-razorpay/{event_id}/replay`
- `DELETE /api/hooks/test-e2e-razorpay`
- `DELETE /api/sessions/test-e2e-razorpay`

Success:

- Tunnel URL endpoint returns either a public URL or a clean unavailable state.
- Session config saves provider, secret state, and forward URL.
- Secret value is not leaked back to frontend responses.
- Fixture request includes Razorpay headers and a valid body.
- Captured event includes provider metadata, signature status, duplicate status, fixture status, and forwarding diagnostics.
- Replay creates a replay event and preserves original body, headers, and query params for forwarding.
- Clear and delete remove expected data.

Likely errors:

- `404` when replaying a deleted or wrong event id.
- `400` for unknown fixture key.
- Signature status becomes `missing` when no secret is configured.
- Signature status becomes `invalid` if the fixture body is modified after signing.
- Forward status becomes `delivery_failure` when the local app target is not running.
- Forward status becomes `retry_risk` when local target returns non-2xx.
- Duplicate detection may not trigger if the Razorpay event id header is missing.

### 6. Frontend Build

Commands:

```powershell
cd frontend
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Success:

- Vite production build completes.
- No JSX syntax errors.
- No missing imports.

Likely errors:

- `vite is not recognized` or `could not determine executable` if dependencies are missing.
- Sandbox `EPERM` while writing `.vite-build-tmp`; rerun outside sandbox if needed.
- JSX compile errors after recent component changes.

Cleanup:

```powershell
Remove-Item ..\.vite-build-tmp -Recurse -Force
```

Only remove this directory after verifying the resolved path is inside the repo.

### 7. Frontend Runtime Smoke

Commands:

```powershell
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Open:

```text
http://127.0.0.1:5173/
```

Success:

- Page loads without blank screen.
- Browser console has no runtime errors.
- The app creates or reads the endpoint id from the hash.
- Current endpoint appears in the endpoint list.
- Setup controls render.
- Event list and inspector render.

Likely errors:

- Frontend starts but API calls fail if backend is not running.
- WebSocket shows disconnected if backend WebSocket is unavailable.
- Browser console may show failed fetches for `/api/*`.
- CORS or proxy issues if frontend and backend origins are not aligned.
- UI may show tunnel unavailable if the tunnel URL file is absent.

### 8. Browser End-To-End Flow

Manual flow:

- Create or use endpoint `test-e2e-razorpay`.
- Set provider to `Razorpay`.
- Save a test secret.
- Set forward target to a local test handler.
- Send `payment.captured` fixture.
- Confirm the event appears in the event list.
- Select the event.
- Confirm inspector shows signature, duplicate, Razorpay event id, payment id, forward result, and payload.
- Replay the event.
- Confirm replay result appears and the inspector explains replay status.
- Clear feed.
- Delete the test endpoint.

Success:

- A developer can prove the full webhook path without going to Razorpay first.
- The UI shows only actionable failure states.
- Replay and duplicate states are understandable from the event row and inspector.

Likely errors:

- Send fixture button fails if backend route is unavailable.
- Event does not appear if WebSocket is disconnected, but history refresh may still show it.
- Forward target errors if no local handler is listening.
- Replay can fail with `404` if selected event id is stale.
- Copy public URL may be disabled if tunnel URL is unavailable.
- Current UI may make failure states hard to read; that is a design issue, not necessarily a functional failure.

### 9. Tunnel And Public URL Check

Checks:

- Start tunnel service through Docker compose.
- Confirm `GET /api/tunnel-url` returns a public URL.
- Confirm frontend public URL updates to `{tunnel_url}/api/hooks/{endpoint_id}`.
- Restart or change tunnel.
- Confirm frontend updates when the backend tunnel URL file changes.

Success:

- Developer sees the current public URL without editing code.
- URL copy action copies the new URL.
- Old public URL is not shown as current after the tunnel changes.

Likely errors:

- Tunnel URL stays unavailable when tunnel process is not running.
- Tunnel URL file is stale.
- Frontend polling delay makes the URL update late.
- External tunnel endpoint cannot be tested if network or Cloudflare credentials are unavailable.

## Error Registry To Capture During Test Run

Record each failure in this format:

```text
Area:
Command or action:
Expected:
Actual:
Likely cause:
Fix or next test:
```

Priority:

- P0: App cannot start.
- P1: Event cannot be captured or viewed.
- P1: Razorpay signature or duplicate diagnostics are wrong.
- P1: Replay sends the wrong payload.
- P2: Forwarding diagnostics are unclear but data is correct.
- P2: Tunnel URL is delayed or stale.
- P3: UI copy, spacing, or visual hierarchy issues.

## Stop Conditions

Stop and fix before redesign if:

- Backend unit tests fail.
- Backend app cannot start in any supported local mode.
- Fixture send cannot create an event.
- Captured event lacks Razorpay metadata or signature status.
- Replay does not create a replay event or uses the wrong payload.
- Frontend has a blank screen or blocking runtime exception.

Do not stop redesign planning for:

- Missing Cloudflare tunnel URL.
- Local forward target not running.
- UI looking bad.
- Browser copy button requiring HTTPS permissions.

## Final Verification Before Redesign

Required clean run:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
cd frontend
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Required browser proof:

- Screenshot of loaded app.
- Screenshot after fixture event is captured.
- Screenshot after selected event inspector shows Razorpay diagnostics.
- Screenshot after replay.

## Next Step

After this plan is approved, run the tests in order and write a short failure report before changing the UI.
