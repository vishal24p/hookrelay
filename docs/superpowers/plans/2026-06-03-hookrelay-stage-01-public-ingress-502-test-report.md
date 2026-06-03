# Stage 01 Test Report: Public Ingress 502

## Status

Verified.

The config change and stage documents were read back successfully. Docker Desktop was started, the Compose stack was brought up, nginx syntax passed, and a fresh public tunnel POST reached the backend with HTTP 200.

## Checks Attempted

- [x] Read repo status after the worker patch.
- [x] Read the Stage 01 plan, completion, test plan, and test report.
- [x] Confirmed `nginx/public.conf` has only the resolver change in the code diff.
- [x] Started Docker Desktop when it was initially unavailable.
- [x] Ran `docker compose up -d --build`.
- [x] Ran `docker compose exec public_ingress nginx -t`.
- [x] Ran `docker compose ps`.
- [x] Public webhook POST reproduction.
- [x] Public ingress log review after restart.
- [x] Backend helper test suite.

## Initial Docker Blocker

`docker compose ps` failed because the Docker Desktop engine pipe is not available:

```text
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

This means the Compose stack cannot be inspected, restarted, or used for nginx/runtime verification from this session until Docker Desktop is running.

Docker Desktop was then launched and became ready.

## Root Cause Fix Check

The targeted code change is present:

```nginx
resolver 127.0.0.11 valid=30s ipv6=off;
```

It is inside the `server` block in `nginx/public.conf`. The existing webhook route and `proxy_pass` target were not changed.

## Verification Output

### nginx Syntax

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### Compose Status

All expected services were running:

- `api`
- `frontend`
- `local_ingress`
- `postgres` healthy
- `public_ingress`
- `redis` healthy
- `tunnel`

### Public Tunnel POST

Tunnel URL observed:

```text
https://harbor-blacks-boxing-rev.trycloudflare.com
```

Smoke endpoint:

```text
stage-01-public-ingress-smoke
```

Public POST result:

```json
{"status":"received","id":137}
```

Local API readback:

```text
event_count = 1
latest_event.id = 137
latest_event.session_id = stage-01-public-ingress-smoke
latest_event.body = {"event":"stage.01.public_ingress_smoke","payload":{"source":"codex-stage-01"}}
```

Latest `public_ingress` log after the restart:

```text
"POST /api/hooks/stage-01-public-ingress-smoke HTTP/1.1" 200
```

The old log entry from 2026-05-26 still contains `no resolver defined to resolve api`, but it did not repeat after the 2026-06-03 restart and fresh POST.

### Backend Tests

The first local command used POSIX-style path separators and discovered zero tests, so it was not counted as a pass.

The Windows path form passed:

```powershell
python -m unittest discover -s backend\tests -p test_*.py
```

Result:

```text
Ran 25 tests in 0.014s
OK
```

## Manual Verification To Repeat Later

```powershell
docker compose exec public_ingress nginx -t
docker compose up -d --force-recreate public_ingress
docker compose logs --no-color public_ingress
```

Then retry the public webhook POST that previously returned 502.

## Expected Result

After recreating `public_ingress`, nginx should be able to resolve `api` through Docker DNS. The specific log error `no resolver defined to resolve api` should not appear for new requests.
