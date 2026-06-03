# Stage 03 Plan: Event Serialization Extraction

## Goal

Move event serialization out of `backend/app/main.py` without changing route behavior.

## Why This Stage

- Stage 01 fixed public ingress.
- Stage 02 added backend API smoke tests.
- The next cleanup step is safe only because route behavior is now covered by tests.

## Scope

- Add `backend/app/event_serialization.py`.
- Move event serialization and Razorpay event diagnostics helpers into that module.
- Keep route handlers in `backend/app/main.py`.
- Keep forwarding and replay behavior unchanged.

## Not In Scope

- No provider framework.
- No router split.
- No response schema changes.
- No frontend changes.

## Implementation Checklist

- [x] Move `serialize_event`.
- [x] Move Razorpay diagnostics helpers required by `serialize_event`.
- [x] Import `serialize_event`, `normalize_provider`, and provider constants from the new module.
- [x] Avoid circular imports.
- [x] Run backend tests.

## Success Criteria

- `python -m unittest discover -s backend\tests -p test_*.py` passes.
- API smoke tests continue to cover capture, duplicate detection, fixture generation, and replay.
- `main.py` no longer owns event serialization details.
