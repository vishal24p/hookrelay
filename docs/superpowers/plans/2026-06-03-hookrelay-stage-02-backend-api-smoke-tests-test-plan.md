# Stage 02 Test Plan: Backend API Smoke Tests

Date: 2026-06-03

## Test Strategy

Use route-level smoke tests that exercise FastAPI handlers through `TestClient` while replacing infrastructure dependencies:

- Database: temporary in-memory SQLite engine.
- Session dependency: `app.dependency_overrides[get_db]`.
- Redis: async fake object with a `publish` method.
- Forwarding: patched `app.main.forward_webhook` only for replay-with-forward coverage.

## Test Cases

1. `test_session_config_create_update_read_redacts_razorpay_secret`
   - PUT Razorpay config with a webhook secret.
   - Assert provider is `razorpay`.
   - Assert `razorpay_webhook_secret_configured` is true.
   - Assert the raw secret and raw secret field are not returned.
   - GET the config and assert the same redacted state.

2. `test_razorpay_fixture_generation_uses_configured_secret`
   - Configure a Razorpay session with a secret.
   - POST a `payment_captured` fixture request.
   - Assert signature generation is true.
   - Assert Razorpay signature and fixture headers exist.
   - Assert body parses as a `payment.captured` event.

3. `test_webhook_capture_stores_event_and_returns_received_id`
   - Configure Razorpay.
   - Generate a signed fixture.
   - POST it to the webhook capture route.
   - Assert response is `received` with an integer id.
   - GET stored events and assert the captured event includes provider, valid signature, and event type diagnostics.

4. `test_duplicate_detection_across_two_razorpay_captures`
   - Configure Razorpay.
   - Capture two fixture events with the same `X-Razorpay-Event-Id`.
   - Assert the second serialized event points `duplicate_of_id` to the first event.

5. `test_replay_requires_existing_event_and_forward_url`
   - Assert replay of a nonexistent event returns 404.
   - Capture a real event without a forward URL.
   - Assert replay returns 400 with the no-forward-url detail.

6. `test_replay_with_configured_forward_url_uses_local_forwarder_patch`
   - Capture a real event before a forward URL is configured.
   - Add a forward URL to the session config.
   - Patch `forward_webhook` with a local async fake.
   - Assert replay returns `replayed` and the patched forward status.

## Required Command

```powershell
python -m unittest discover -s backend\tests -p test_*.py
```

## Expected Result

The full backend unittest suite should pass without Docker, Postgres, Redis, or external network access.
