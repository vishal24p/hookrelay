# Stage 02 Completion: Backend API Smoke Tests

Date: 2026-06-03

## Completed Work

Added `backend/tests/test_api_smoke.py` with route-level smoke coverage for the backend API.

The test file uses:

- FastAPI `TestClient`.
- In-memory SQLite via SQLAlchemy `StaticPool`.
- `app.dependency_overrides[get_db]`.
- A small async Redis fake.
- A patched `app.main.forward_webhook` for replay-with-forward coverage.
- `app.url_path_for(...)` to avoid hardcoding route paths.

## Coverage Added

- Razorpay session config create/read with secret redaction.
- Razorpay fixture generation with configured secret and generated signature.
- Webhook capture storing an event and returning `received` plus event id.
- Duplicate detection across two captured Razorpay events with the same provider event id.
- Replay 404 for missing events.
- Replay 400 when no forward URL is configured.
- Replay success path with a configured forward URL and patched local forwarder.

## Out-of-Scope Items

The current fixture response model does not include `method` or `path`. That appears to be outside this stage's allowed write scope because adding those fields would require backend schema/route changes.

No backend route behavior was changed.

## Verification Status

Verified.

```powershell
python -m unittest discover -s backend\tests -p test_*.py
```

Result:

```text
Ran 31 tests in 0.480s
OK
```

## SQLite Import Fix Update

- The Stage 02 route test run exposed an import-time failure in `backend/app/main.py`.
- Failure: `ensure_session_config_columns()` executed during app import and issued Postgres-specific `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` SQL against the SQLite test database.
- Fix: `ensure_session_config_columns()` now returns early when `engine.dialect.name == "sqlite"`. This preserves the existing Postgres migration behavior and lets SQLite tests rely on `Base.metadata.create_all(bind=engine)` to create the current `session_configs` columns.
- Verification: the full backend unittest suite passed after the SQLite import fix.
