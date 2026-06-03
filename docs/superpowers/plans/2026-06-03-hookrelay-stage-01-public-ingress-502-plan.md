# Stage 01 Plan: Public Ingress 502

## Problem

- Public webhook POSTs return 502.
- Public ingress logs show `no resolver defined to resolve api`.
- The public ingress nginx config proxies from a regex location using variables:
  - `location ~ ^/api/hooks/([^/]+)$`
  - `proxy_pass http://api:8000/hooks/$1$is_args$args;`

## Cause

- nginx requires an explicit `resolver` when `proxy_pass` contains variables.
- In Docker Compose, service names are resolved by Docker embedded DNS at `127.0.0.11`.
- Without that resolver, nginx cannot resolve the `api` service name at request time.

## Scope

- Change only `nginx/public.conf` for runtime behavior.
- Add stage documentation for plan, test plan, completion, and test report.
- Do not refactor routing.
- Do not change Compose services, networks, API routes, or tunnel behavior.

## Implementation Checklist

- [x] Add Docker embedded DNS resolver inside the public ingress `server` block.
- [x] Keep the existing regex location and `proxy_pass` target unchanged.
- [x] Document the fix and tests tied to the 502 failure.

## Expected Code Change

```nginx
resolver 127.0.0.11 valid=30s ipv6=off;
```

This lets nginx resolve `api` through Docker DNS when evaluating the variable-based `proxy_pass`.
