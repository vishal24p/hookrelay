# Stage 01 Completion: Public Ingress 502

## Summary

Stage 01 added Docker embedded DNS resolution to the public ingress nginx server block.

Runtime verification passed after Docker Desktop was started.

## Completed

- [x] Added `resolver 127.0.0.11 valid=30s ipv6=off;` to `nginx/public.conf`.
- [x] Left the public webhook regex route unchanged.
- [x] Left `proxy_pass http://api:8000/hooks/$1$is_args$args;` unchanged.
- [x] Added stage plan, test plan, completion, and test report files.

## Why This Fix

The public ingress route uses captures and query-string variables in `proxy_pass`. With variables present, nginx resolves the upstream host at request time. Docker service name `api` is only resolvable through Docker embedded DNS inside the container network, so the public ingress needs:

```nginx
resolver 127.0.0.11 valid=30s ipv6=off;
```

## Files Changed

- `nginx/public.conf`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-01-public-ingress-502-plan.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-01-public-ingress-502-completion.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-01-public-ingress-502-test-plan.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-01-public-ingress-502-test-report.md`

## Verification Status

- [x] Code diff confirmed: only `nginx/public.conf` changed for runtime behavior.
- [x] Stage files were created and read back.
- [x] `docker compose exec public_ingress nginx -t` passed.
- [x] `docker compose up -d --build` started the stack.
- [x] Public tunnel POST returned `{"status":"received","id":137}`.
- [x] Local API readback confirmed event `137` for `stage-01-public-ingress-smoke`.
- [x] Latest public ingress log showed HTTP `200` for the fresh public POST.
- [x] Backend helper tests passed: `Ran 25 tests`.

## Out Of Scope

- No route refactor.
- No Compose network changes.
- No API service changes.
- No tunnel changes.
