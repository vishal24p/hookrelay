# Stage 01 Test Plan: Public Ingress 502

## Goal

Verify that public ingress can resolve the Docker Compose service name `api` when handling public webhook POSTs through the variable-based nginx `proxy_pass`.

## Checks

- [ ] Validate nginx config syntax.
- [ ] Restart or recreate `public_ingress` if the Compose stack is running.
- [ ] Reproduce the public webhook POST that previously returned 502.
- [ ] Confirm public ingress logs no longer include `no resolver defined to resolve api`.

## Narrow Commands

Use these checks when the local shell and Docker stack are available:

```powershell
docker compose exec public_ingress nginx -t
docker compose up -d --force-recreate public_ingress
docker compose logs --no-color public_ingress
```

If a public tunnel URL is available, send a POST to:

```text
POST <public-tunnel-url>/api/hooks/<hook-id>
```

## Expected Result

- nginx config syntax passes.
- Public ingress starts cleanly.
- The webhook POST no longer fails because nginx cannot resolve `api`.
- Any remaining failure, if present, should be outside the known nginx resolver error.
