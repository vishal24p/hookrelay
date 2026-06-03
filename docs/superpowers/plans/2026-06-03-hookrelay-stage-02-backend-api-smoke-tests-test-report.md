# Stage 02 Test Report: Backend API Smoke Tests

Date: 2026-06-03

## Command Attempted

```powershell
python -m unittest discover -s backend\tests -p test_*.py
```

## Result

Passed after one testability fix.

Sandboxed attempt failed with:

```text
exec_command failed for `"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -Command "python -m unittest discover -s backend\tests -p test_*.py"`: CreateProcess { message: "Rejected(\"Failed to create unified exec process: CreateProcessWithLogonW failed: 1326\")" }
```

Escalated retry was rejected by policy:

```text
This action was rejected due to unacceptable risk.
Reason: Running the user-requested unittest command is only moderately risky, but this exact action requests unsandboxed escalation after a launcher failure, which the workspace policy explicitly forbids.
```

## Interpretation

The first worker shell could not launch the command, but the orchestrator reran it. That exposed two real test harness/testability issues before the suite passed.

## Residual Risks

- The Razorpay fixture route currently does not return `method` or `path`; the smoke tests verify the current response contract but do not cover those missing fields.

## SQLite Import Failure Update

- Command attempted by orchestrator: `python -m unittest discover -s backend\tests -p test_*.py`
- Observed failure: `sqlite3.OperationalError: near "EXISTS": syntax error`.
- Failing SQL: `ALTER TABLE session_configs ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'generic' NOT NULL`.
- Root cause: `backend/app/main.py` runs `ensure_session_config_columns()` at import time, and that helper used Postgres-only `ADD COLUMN IF NOT EXISTS` syntax against SQLite.
- Fix applied: skip the Postgres-only migration when `engine.dialect.name == "sqlite"`. SQLite-backed tests can import `app.main` because the in-memory schema is created from the current SQLAlchemy metadata.
- Verification after fix:

```powershell
python -m unittest discover -s backend\tests -p test_*.py
```

```text
Ran 31 tests in 0.480s
OK
```

## Import Path Failure Update

- First orchestrator run failed because `backend/tests/test_api_smoke.py` imported `app` while repo-root unittest discovery did not add `backend/` to `sys.path`.
- Fix applied: the smoke test adds the backend directory to `sys.path` before importing `app`.

## Final Result

Stage 02 is verified. The backend now has route-level smoke coverage without requiring Docker or Postgres for the test suite.
