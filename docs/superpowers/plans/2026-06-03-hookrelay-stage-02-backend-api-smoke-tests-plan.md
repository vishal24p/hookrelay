# Stage 02 Plan: Backend API Smoke Tests

Date: 2026-06-03

## Scope

Add route-level backend smoke tests for the cleanup audit without changing backend application code.

Allowed write scope:

- `backend/tests/test_api_smoke.py`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-02-backend-api-smoke-tests-plan.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-02-backend-api-smoke-tests-completion.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-02-backend-api-smoke-tests-test-plan.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-02-backend-api-smoke-tests-test-report.md`

## Implementation Plan

1. Inspect the backend route, database, model, schema, and existing unittest style.
2. Add `unittest` smoke tests using FastAPI `TestClient`.
3. Override `get_db` with an in-memory SQLite database using SQLAlchemy `StaticPool`.
4. Install a small async Redis fake on `app.state.redis` so webhook capture and replay publishing do not require Redis.
5. Use `app.url_path_for(...)` instead of hardcoded route paths.
6. Cover:
   - Razorpay session config create/read with secret redaction.
   - Razorpay fixture request generation using the configured secret.
   - Webhook capture storing an event and returning `status=received` with an id.
   - Duplicate Razorpay event detection across two captures with the same Razorpay event id.
   - Replay missing event, replay without forward URL, and replay with configured forward URL through a patched local forwarder.
7. Run:

```powershell
python -m unittest discover -s backend\tests -p test_*.py
```

## Constraints

- Do not require Docker, Postgres, or Redis.
- Do not perform external network calls.
- Do not edit backend application code in this stage.
- If tests expose a product bug requiring app changes, stop and report it instead of editing outside scope.

## Observed Contract Note

The current Razorpay fixture response model exposes `fixture_key`, `label`, `headers`, `body`, and `signature_generated`. It does not expose `method` or `path`. The smoke test covers the current backend contract and records the missing `method`/`path` shape as residual risk.
