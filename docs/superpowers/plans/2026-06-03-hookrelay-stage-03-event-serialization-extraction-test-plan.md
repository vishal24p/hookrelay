# Stage 03 Test Plan: Event Serialization Extraction

## Goal

Prove that extracting event serialization did not change backend route behavior.

## Commands

```powershell
python -m unittest discover -s backend\tests -p test_*.py
```

## Checks

- [ ] Session config route tests pass.
- [ ] Fixture generation route tests pass.
- [ ] Webhook capture route tests pass.
- [ ] Duplicate detection route tests pass.
- [ ] Replay route tests pass.
- [ ] Existing helper tests pass.

## Expected Result

```text
OK
```
