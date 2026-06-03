# Stage 03 Completion: Event Serialization Extraction

## Summary

Event serialization moved from `backend/app/main.py` into `backend/app/event_serialization.py`.

## Completed

- [x] Added `backend/app/event_serialization.py`.
- [x] Moved `serialize_event`.
- [x] Moved the Razorpay diagnostics helper chain used by `serialize_event`.
- [x] Kept route handlers in `backend/app/main.py`.
- [x] Avoided circular imports by keeping serialization dependencies out of `main.py`.

## Files Changed

- `backend/app/event_serialization.py`
- `backend/app/main.py`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-03-event-serialization-extraction-plan.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-03-event-serialization-extraction-completion.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-03-event-serialization-extraction-test-plan.md`
- `docs/superpowers/plans/2026-06-03-hookrelay-stage-03-event-serialization-extraction-test-report.md`

## Behavior

No route behavior was intentionally changed.

## Verification Status

Verified.

```powershell
python -m unittest discover -s backend\tests -p test_*.py
```

Result:

```text
Ran 31 tests in 0.537s
OK
```

## Notes

- Moving only `serialize_event` would have caused a circular import because Razorpay diagnostics lived in `main.py`.
- The extraction moved the small Razorpay diagnostics helper chain with the serializer.
- `json` remains imported in `main.py` because `receive_webhook` still uses `json.dumps` for Redis publish payloads.
