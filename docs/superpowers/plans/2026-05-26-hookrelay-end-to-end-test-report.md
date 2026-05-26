# HookRelay End-To-End Test Report

## Summary

Current local app path mostly works. The public tunnel path does not.

The backend helper tests pass, Docker Compose can run the stack, the local API can capture Razorpay fixture events, signature diagnostics work, duplicate detection works, replay creates a replay event when a forward URL is configured, and the frontend renders the seeded event in the browser.

The main blocker is public ingress: the app shows a Cloudflare tunnel URL, but posting to that public URL returns `502 Bad Gateway`.

## Environment

- Date: 2026-05-26
- Workspace: `C:\Users\visha\hookrelay`
- Local app URL: `http://127.0.0.1/`
- Tunnel URL observed: `https://softball-external-halloween-chrome.trycloudflare.com`
- Browser proof screenshot: `artifacts/hookrelay-e2e-browser-smoke.png`

## Results

### 1. Baseline Worktree

Status: Passed as a baseline check.

The repo already had many dirty files from previous work. This is not a test failure.

### 2. Dependency And Environment Check

Status: Mixed.

Passed:

- `frontend\node_modules\.bin\vite.cmd` exists.
- `backend\requirements.txt` exists.
- Docker Compose works when run with permission.

Initial failures:

- `docker compose ps` failed without permission:

```text
open //./pipe/dockerDesktopLinuxEngine: Access is denied.
```

This is an environment/permission issue, not an app bug.

### 3. Backend Unit Tests

Status: Passed.

Command:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
```

Result:

```text
Ran 25 tests in 0.003s
OK
```

Covered:

- Razorpay metadata extraction.
- Razorpay duplicate detection.
- Razorpay fixture generation and signature generation.
- Forwarding diagnostics.
- Replay payload construction.

### 4. Frontend Build

Status: Passed after permission retry.

Initial sandbox failure:

```text
EPERM: operation not permitted, mkdir 'C:\Users\visha\hookrelay\.vite-build-tmp'
```

Retry outside sandbox passed:

```text
vite v5.4.21 building for production...
40 modules transformed.
index.html 0.45 kB
index-CiAyMyxa.js 212.43 kB
built in 1.39s
```

Note:

- Vite emitted its normal CJS Node API deprecation warning. This is not blocking.

### 5. Docker Compose Startup

Status: Passed.

Services running:

- `api`
- `frontend`
- `local_ingress`
- `postgres` healthy
- `public_ingress`
- `redis` healthy
- `tunnel`

Local ingress is exposed at:

```text
127.0.0.1:80
```

### 6. Local API Smoke

Status: Passed.

Test endpoint:

```text
test-e2e-razorpay
```

Validated:

- `GET /api/health` returned `ok`.
- `GET /api/tunnel-url` returned a tunnel URL.
- Session config can be saved with provider `razorpay`, secret, and forward URL.
- Secret was not leaked back in the config response.
- Razorpay fixture request generated a signed `payment_captured` payload.
- `POST /api/hooks/{session}` captured the fixture.
- Captured event included:
  - `provider_event_type = payment.captured`
  - `signature_status = valid`
  - `is_local_fixture = true`
  - Razorpay payment id
  - Razorpay event id
  - forwarding diagnostics
- Replay created a new event when a forward URL was configured.
- Clear/delete cleanup worked.

Expected non-blocking result:

- Forward delivery status was `delivery_failure` because the configured local handler target was intentionally not running.

### 7. Duplicate Detection Smoke

Status: Passed.

Test endpoint:

```text
test-e2e-duplicate
```

Result:

- First event had no duplicate.
- Second event reused the same `X-Razorpay-Event-Id`.
- Second event returned `duplicate_of_id` pointing to the first event.
- Both events had valid Razorpay signature diagnostics.

### 8. Browser Smoke

Status: Passed with fallback.

The in-app browser automation bridge failed:

```text
Extension connection timeout. Make sure the "Playwright MCP Bridge" extension is installed.
```

Fallback used:

- Headless Chrome loaded `http://127.0.0.1/#ui-e2e-razorpay`.
- Screenshot was captured successfully.
- The UI rendered:
  - endpoint `ui-e2e-razorpay`
  - public URL
  - provider `Razorpay`
  - secret configured
  - forward target configured
  - two captured events
  - selected replay event
  - inspector body
  - delivery failure chip

Screenshot:

```text
artifacts/hookrelay-e2e-browser-smoke.png
```

### 9. Public Tunnel Webhook Test

Status: Failed.

Local backend returned a tunnel URL:

```text
https://softball-external-halloween-chrome.trycloudflare.com
```

Posting a signed Razorpay fixture to:

```text
https://softball-external-halloween-chrome.trycloudflare.com/api/hooks/public-e2e-razorpay
```

failed with:

```text
502 Bad Gateway
```

Tunnel logs show Cloudflare tunnel itself is connected:

```text
Tunnel URL written: https://softball-external-halloween-chrome.trycloudflare.com
Connectivity pre-checks: PASS
```

Public ingress logs show the actual failure:

```text
no resolver defined to resolve api
request: "POST /api/hooks/public-e2e-razorpay HTTP/1.1"
```

Conclusion:

- The Cloudflare tunnel is up.
- The public nginx ingress receives the request.
- `public_ingress` cannot resolve the Docker service name `api` at request time.
- This breaks the real provider-facing webhook path.

## Error Registry

### P1: Public Webhook URL Returns 502

Area: Public tunnel and public ingress.

Command or action:

```powershell
POST https://softball-external-halloween-chrome.trycloudflare.com/api/hooks/public-e2e-razorpay
```

Expected:

- Event is captured by backend through public tunnel URL.

Actual:

- `502 Bad Gateway`.
- nginx log: `no resolver defined to resolve api`.

Likely cause:

- `nginx/public.conf` uses `proxy_pass http://api:8000/...` in a regex location with a variable path. nginx requires an explicit Docker DNS resolver for runtime upstream name resolution in this form.

Fix or next test:

- Add Docker DNS resolver to `public.conf`, likely `resolver 127.0.0.11 valid=30s ipv6=off;`.
- Retest public POST through the Cloudflare URL.

### P2: Browser Automation Bridge Missing

Area: Browser test tooling.

Action:

- In-app browser navigation through Playwright MCP.

Expected:

- Browser automation can navigate to `http://127.0.0.1/`.

Actual:

```text
Extension connection timeout.
```

Likely cause:

- Playwright MCP Bridge extension is not installed or not connected.

Fix or next test:

- Use headless Chrome fallback for screenshots.
- Install/enable bridge only if interactive browser automation is needed.

### P2: Docker Requires Elevated Access

Area: Environment.

Action:

```powershell
docker compose ps
```

Expected:

- Compose status is readable.

Actual:

```text
open //./pipe/dockerDesktopLinuxEngine: Access is denied.
```

Likely cause:

- Sandbox cannot access Docker Desktop pipe.

Fix or next test:

- Run Docker checks with permission.

### P3: Vite Build Needs Permission For Temporary Output

Area: Frontend build environment.

Action:

```powershell
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
```

Expected:

- Build writes to `.vite-build-tmp`.

Actual:

```text
EPERM: operation not permitted, mkdir 'C:\Users\visha\hookrelay\.vite-build-tmp'
```

Likely cause:

- Sandbox write restriction around build output.

Fix or next test:

- Rerun with permission or use an allowed output path.

## What This Means Before Redesign

Do not start the UI redesign implementation yet.

Fix the public ingress 502 first. The whole product promise is that the developer can copy a public webhook URL into Razorpay and receive events locally. Right now the UI can show a tunnel URL, but that URL fails when used as the provider-facing endpoint.

After that fix, rerun:

```powershell
python -m unittest discover -s backend/tests -p "test_*.py"
npm exec vite -- build --outDir ../.vite-build-tmp --emptyOutDir
POST {tunnel_url}/api/hooks/{session}
```

Then continue with the selected design direction.
