import asyncio
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.websockets import WebSocketDisconnect

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["DATABASE_URL"] = "sqlite://"

from app import models
from app.database import get_db
from app.main import app, forward_webhook


class FakeRedis:
    def __init__(self):
        self.messages = []

    async def publish(self, channel, message):
        self.messages.append((channel, message))
        return 1

    async def ping(self):
        return True


class ApiSmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "api_smoke.sqlite3"
        self.engine = create_async_engine(
            URL.create("sqlite+aiosqlite", database=str(self.db_path)),
        )
        self.SessionLocal = async_sessionmaker(
            autoflush=False,
            expire_on_commit=False,
            bind=self.engine,
        )
        asyncio.run(self.create_schema())

        async def override_get_db():
            async with self.SessionLocal() as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        app.state.redis = FakeRedis()
        self.client = TestClient(app)

    async def create_schema(self):
        async with self.engine.begin() as connection:
            await connection.run_sync(models.Base.metadata.create_all)

    async def add_cleanup_events(self, session_id, old_time):
        async with self.SessionLocal() as db:
            db.add(models.WebhookEvent(session_id=session_id, method="POST", headers={}, body="old", received_at=old_time))
            db.add(models.WebhookEvent(session_id=session_id, method="POST", headers={}, body="recent"))
            await db.commit()

    async def get_events_for_session(self, session_id):
        async with self.SessionLocal() as db:
            result = await db.execute(
                select(models.WebhookEvent).where(models.WebhookEvent.session_id == session_id)
            )
            return result.scalars().all()

    async def get_event(self, event_id):
        async with self.SessionLocal() as db:
            result = await db.execute(
                select(models.WebhookEvent).where(models.WebhookEvent.id == event_id)
            )
            return result.scalar_one_or_none()

    def tearDown(self):
        try:
            self.client.close()
        finally:
            app.dependency_overrides.clear()
            try:
                asyncio.run(self.engine.dispose())
            finally:
                self.temp_dir.cleanup()

    def path_for(self, route_name, **params):
        return str(app.url_path_for(route_name, **params))

    def auth_headers(self, token):
        return {"Authorization": f"Bearer {token}"}

    def init_session(self, session_id="smoke-session", token=None):
        response = self.client.post(
            self.path_for("init_session", session_id=session_id),
            headers=self.auth_headers(token) if token else None,
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def configure_razorpay_session(self, session_id="smoke-session", secret="smoke_secret"):
        init = self.init_session(session_id)
        token = init["auth_token"]
        response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={
                "provider": "razorpay",
                "razorpay_webhook_secret": secret,
            },
            headers=self.auth_headers(token),
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        payload["auth_token"] = token
        return payload

    def fixture_request(self, session_id="smoke-session", token=None):
        response = self.client.post(
            self.path_for(
                "create_razorpay_fixture_request",
                session_id=session_id,
                fixture_key="payment_captured",
            ),
            headers=self.auth_headers(token) if token else None,
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def capture_fixture_event(self, session_id="smoke-session", event_id=None, token=None):
        fixture = self.fixture_request(session_id, token)
        headers = dict(fixture["headers"])
        if event_id is not None:
            headers["X-Razorpay-Event-Id"] = event_id
        response = self.client.post(
            self.path_for("receive_webhook", session_id=session_id),
            content=fixture["body"],
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_session_config_create_update_read_redacts_razorpay_secret(self):
        session_id = "smoke-config"
        secret = "do_not_leak"
        init = self.init_session(session_id)
        token = init["auth_token"]
        self.assertTrue(init["auth_token_configured"])
        self.assertIsInstance(token, str)

        put_response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={
                "provider": "razorpay",
                "razorpay_webhook_secret": secret,
            },
            headers=self.auth_headers(token),
        )

        self.assertEqual(put_response.status_code, 200)
        saved = put_response.json()
        self.assertEqual(saved["session_id"], session_id)
        self.assertEqual(saved["provider"], "razorpay")
        self.assertTrue(saved["razorpay_webhook_secret_configured"])
        self.assertTrue(saved["auth_token_configured"])
        self.assertIsNone(saved["auth_token"])
        self.assertNotIn("razorpay_webhook_secret", saved)
        self.assertNotIn(secret, json.dumps(saved))

        get_response = self.client.get(
            self.path_for("get_session_config", session_id=session_id),
            headers=self.auth_headers(token),
        )

        self.assertEqual(get_response.status_code, 200)
        loaded = get_response.json()
        self.assertEqual(loaded["provider"], "razorpay")
        self.assertTrue(loaded["razorpay_webhook_secret_configured"])
        self.assertTrue(loaded["auth_token_configured"])
        self.assertIsNone(loaded["auth_token"])
        self.assertNotIn("razorpay_webhook_secret", loaded)
        self.assertNotIn(secret, json.dumps(loaded))

    def test_session_init_creates_and_rotates_token(self):
        session_id = "smoke-init"
        created = self.init_session(session_id)
        first_token = created["auth_token"]

        unauthenticated_rotate = self.client.post(
            self.path_for("init_session", session_id=session_id),
        )
        self.assertEqual(unauthenticated_rotate.status_code, 401)

        rotated = self.init_session(session_id, token=first_token)
        second_token = rotated["auth_token"]
        self.assertNotEqual(first_token, second_token)

        old_token_response = self.client.get(
            self.path_for("get_session_config", session_id=session_id),
            headers=self.auth_headers(first_token),
        )
        self.assertEqual(old_token_response.status_code, 401)

        new_token_response = self.client.get(
            self.path_for("get_session_config", session_id=session_id),
            headers=self.auth_headers(second_token),
        )
        self.assertEqual(new_token_response.status_code, 200)

    def test_sessionless_local_routes_require_any_valid_token(self):
        config = self.configure_razorpay_session("smoke-sessionless", "sessionless_secret")

        missing_response = self.client.get(self.path_for("get_sessions"))
        self.assertEqual(missing_response.status_code, 401)

        valid_response = self.client.get(
            self.path_for("get_sessions"),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(valid_response.status_code, 200)
        self.assertIn("smoke-sessionless", valid_response.json())

    def test_websocket_rejects_missing_or_wrong_token(self):
        config = self.configure_razorpay_session("smoke-ws", "ws_secret")

        with self.assertRaises(WebSocketDisconnect) as missing:
            with self.client.websocket_connect(self.path_for("websocket_endpoint", session_id="smoke-ws")):
                pass
        self.assertEqual(missing.exception.code, 1008)

        with self.assertRaises(WebSocketDisconnect) as invalid:
            with self.client.websocket_connect(
                self.path_for("websocket_endpoint", session_id="smoke-ws") + "?token=wrong-token"
            ):
                pass
        self.assertEqual(invalid.exception.code, 1008)

        self.assertIsInstance(config["auth_token"], str)

    def test_razorpay_fixture_generation_uses_configured_secret(self):
        config = self.configure_razorpay_session("smoke-fixture", "fixture_secret")

        fixture = self.fixture_request("smoke-fixture", config["auth_token"])

        self.assertEqual(fixture["fixture_key"], "payment_captured")
        self.assertTrue(fixture["signature_generated"])
        self.assertIsInstance(fixture["headers"], dict)
        self.assertIn("X-Razorpay-Signature", fixture["headers"])
        self.assertEqual(fixture["headers"]["X-HookRelay-Fixture-Key"], "payment_captured")
        body = json.loads(fixture["body"])
        self.assertEqual(body["event"], "payment.captured")

    def test_webhook_capture_stores_event_and_returns_received_id(self):
        config = self.configure_razorpay_session("smoke-capture", "capture_secret")

        capture = self.capture_fixture_event("smoke-capture", token=config["auth_token"])

        self.assertEqual(capture["status"], "received")
        self.assertIsInstance(capture["id"], int)

        events_response = self.client.get(
            self.path_for("get_webhooks", session_id="smoke-capture"),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(events_response.status_code, 200)
        events = events_response.json()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["id"], capture["id"])
        self.assertEqual(events[0]["provider"], "razorpay")
        self.assertEqual(events[0]["signature_status"], "valid")
        self.assertEqual(events[0]["provider_event_type"], "payment.captured")

    def test_duplicate_detection_across_two_razorpay_captures(self):
        config = self.configure_razorpay_session("smoke-duplicate", "duplicate_secret")
        duplicate_event_id = "evt_duplicate_smoke"

        first = self.capture_fixture_event("smoke-duplicate", duplicate_event_id, config["auth_token"])
        second = self.capture_fixture_event("smoke-duplicate", duplicate_event_id, config["auth_token"])

        events_response = self.client.get(
            self.path_for("get_webhooks", session_id="smoke-duplicate"),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(events_response.status_code, 200)
        events = events_response.json()
        self.assertEqual(len(events), 2)

        by_id = {event["id"]: event for event in events}
        self.assertIsNone(by_id[first["id"]]["duplicate_of_id"])
        self.assertEqual(by_id[second["id"]]["duplicate_of_id"], first["id"])

    def test_replay_requires_existing_event_and_forward_url(self):
        config = self.configure_razorpay_session("smoke-replay", "replay_secret")

        missing_response = self.client.post(
            self.path_for(
                "replay_event",
                session_id="smoke-replay",
                event_id=999,
            ),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(missing_response.status_code, 404)

        capture = self.capture_fixture_event("smoke-replay", token=config["auth_token"])
        no_forward_response = self.client.post(
            self.path_for(
                "replay_event",
                session_id="smoke-replay",
                event_id=capture["id"],
            ),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(no_forward_response.status_code, 400)
        self.assertEqual(
            no_forward_response.json()["detail"],
            "No forwarding URL configured for this session",
        )

    def test_get_webhooks_supports_limit_and_before_id(self):
        session_id = "smoke-pagination"
        config = self.configure_razorpay_session(session_id, "pagination_secret")

        for index in range(3):
            request = self.fixture_request(session_id, config["auth_token"])
            request["headers"]["X-Razorpay-Event-Id"] = f"evt_pagination_{index}"
            response = self.client.post(
                self.path_for("receive_webhook", session_id=session_id),
                content=request["body"],
                headers=request["headers"],
            )
            self.assertEqual(response.status_code, 200)

        response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id) + "?limit=2",
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(response.status_code, 200)
        first_page = response.json()
        self.assertEqual(len(first_page), 2)
        self.assertGreater(first_page[0]["id"], first_page[1]["id"])

        before_id = first_page[-1]["id"]
        response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id) + f"?before_id={before_id}",
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(response.status_code, 200)
        older_events = response.json()
        if older_events:
            self.assertTrue(all(event["id"] < before_id for event in older_events))

    def test_health_reports_dependency_keys(self):
        response = self.client.get(self.path_for("health"))

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("status", payload)
        self.assertIn("postgres", payload)
        self.assertIn("redis", payload)
        self.assertIn("tunnel_url_present", payload)
        self.assertEqual(payload["redis"], "ok")

    def test_cleanup_deletes_old_events_for_authorized_session(self):
        session_id = "smoke-cleanup"
        config = self.configure_razorpay_session(session_id, "cleanup_secret")
        old_time = models.datetime.utcnow() - __import__("datetime").timedelta(days=8)

        asyncio.run(self.add_cleanup_events(session_id, old_time))

        response = self.client.post(
            self.path_for("cleanup_events"),
            json={"session_id": session_id, "older_than": "7d"},
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted_events"], 1)

        remaining = asyncio.run(self.get_events_for_session(session_id))
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0].body, "recent")

    def test_replay_with_configured_forward_url_uses_local_forwarder_patch(self):
        session_id = "smoke-replay-forward"
        config = self.configure_razorpay_session(session_id, "replay_forward_secret")
        capture_fixture_event_id = "evt_replay_forward"
        original = self.fixture_request(session_id, config["auth_token"])
        original["headers"]["X-Razorpay-Event-Id"] = capture_fixture_event_id
        capture_response = self.client.post(
            self.path_for("receive_webhook", session_id=session_id),
            content=original["body"],
            headers=original["headers"],
        )
        self.assertEqual(capture_response.status_code, 200)

        self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={
                "provider": "razorpay",
                "razorpay_webhook_secret": "replay_forward_secret",
                "forward_url": "http://8.8.8.8/webhook",
            },
            headers=self.auth_headers(config["auth_token"]),
        )

        async def fake_forward_webhook(forward_url, body, headers=None, query_params=None):
            self.assertEqual(forward_url, "http://8.8.8.8/webhook")
            self.assertTrue(body)
            self.assertEqual(headers["x-razorpay-event-id"], capture_fixture_event_id)
            return 202, "accepted", None, None

        with patch("app.main.forward_webhook", fake_forward_webhook):
            replay_response = self.client.post(
                self.path_for(
                    "replay_event",
                    session_id=session_id,
                    event_id=capture_response.json()["id"],
                ),
                headers=self.auth_headers(config["auth_token"]),
            )

        self.assertEqual(replay_response.status_code, 200)
        replay = replay_response.json()
        self.assertEqual(replay["status"], "replayed")
        self.assertEqual(replay["forward_status"], 202)
        self.assertNotEqual(replay["id"], capture_response.json()["id"])
        events_response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(events_response.status_code, 200)
        replay_rows = [event for event in events_response.json() if event["id"] == replay["id"]]
        self.assertEqual(len(replay_rows), 1)
        self.assertEqual(replay_rows[0]["replay_target_event_id"], capture_response.json()["id"])

    def test_forged_razorpay_webhook_is_rejected_without_saving_event(self):
        session_id = "smoke-forged"
        config = self.configure_razorpay_session(session_id, "forged_secret")
        fixture = self.fixture_request(session_id, config["auth_token"])
        fixture["headers"]["X-Razorpay-Signature"] = "not-the-real-signature"

        response = self.client.post(
            self.path_for("receive_webhook", session_id=session_id),
            content=fixture["body"],
            headers=fixture["headers"],
        )

        self.assertEqual(response.status_code, 401)
        events_response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(events_response.status_code, 200)
        self.assertEqual(events_response.json(), [])

    def test_razorpay_mode_without_secret_accepts_unverified_local_debug_event(self):
        session_id = "smoke-missing-secret"
        init = self.init_session(session_id)
        token = init["auth_token"]
        update_response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={"provider": "razorpay"},
            headers=self.auth_headers(token),
        )
        self.assertEqual(update_response.status_code, 200)

        response = self.client.post(
            self.path_for("receive_webhook", session_id=session_id),
            content='{"event":"payment.captured"}',
            headers={"X-Razorpay-Event-Id": "evt_missing_secret"},
        )
        self.assertEqual(response.status_code, 200)

        events_response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id),
            headers=self.auth_headers(token),
        )
        self.assertEqual(events_response.status_code, 200)
        events = events_response.json()
        self.assertEqual(events[0]["signature_status"], "missing_secret")

    def test_local_session_endpoint_requires_bearer_token_after_config_creation(self):
        session_id = "smoke-auth"
        config = self.configure_razorpay_session(session_id, "auth_secret")
        self.capture_fixture_event(session_id, token=config["auth_token"])

        missing_response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id)
        )
        self.assertEqual(missing_response.status_code, 401)

        invalid_response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id),
            headers=self.auth_headers("wrong-token"),
        )
        self.assertEqual(invalid_response.status_code, 401)

        valid_response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(valid_response.status_code, 200)
        self.assertEqual(len(valid_response.json()), 1)

    def test_invalid_forward_url_is_rejected(self):
        session_id = "smoke-invalid-forward-url"
        config = self.configure_razorpay_session(session_id, "forward_secret")

        response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={"forward_url": "http://169.254.169.254/latest/meta-data"},
            headers=self.auth_headers(config["auth_token"]),
        )

        self.assertEqual(response.status_code, 400)

    def test_forward_url_validator_rejects_loopback_ip_by_default(self):
        session_id = "smoke-loopback-forward-url"
        config = self.configure_razorpay_session(session_id, "loopback_secret")

        response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={"forward_url": "http://127.0.0.1:3000/webhook"},
            headers=self.auth_headers(config["auth_token"]),
        )

        self.assertEqual(response.status_code, 400)

    def test_forward_url_allow_loopback_override(self):
        session_id = "smoke-loopback-override"
        config = self.configure_razorpay_session(session_id, "loopback_override_secret")

        with patch.dict(os.environ, {"ALLOW_LOOPBACK_FORWARD": "1"}):
            response = self.client.put(
                self.path_for("update_session_config", session_id=session_id),
                json={"forward_url": "http://127.0.0.1:3000/webhook"},
                headers=self.auth_headers(config["auth_token"]),
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["forward_url"], "http://127.0.0.1:3000/webhook")

    def test_forward_webhook_does_not_follow_redirects(self):
        captured = {}

        class FakeAsyncClient:
            def __init__(self, timeout, follow_redirects):
                captured["follow_redirects"] = follow_redirects

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def post(self, forward_url, content=None, headers=None, params=None):
                captured["forward_url"] = forward_url
                return SimpleNamespace(status_code=302, text="redirect")

        with patch("app.main.httpx.AsyncClient", FakeAsyncClient):
            status, body, error, failure_kind = asyncio.run(forward_webhook("http://8.8.8.8/webhook", b"{}"))

        self.assertFalse(captured["follow_redirects"])
        self.assertEqual(captured["forward_url"], "http://8.8.8.8/webhook")
        self.assertEqual(status, 302)
        self.assertEqual(body, "redirect")
        self.assertIsNone(error)
        self.assertIsNone(failure_kind)

    def test_replay_non_2xx_forwarding_returns_502_after_recording_event(self):
        session_id = "smoke-replay-502"
        config = self.configure_razorpay_session(session_id, "replay_502_secret")
        capture = self.capture_fixture_event(session_id, token=config["auth_token"])

        update_response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={"forward_url": "http://8.8.8.8/webhook"},
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(update_response.status_code, 200)

        async def fake_forward_webhook(forward_url, body, headers=None, query_params=None):
            return 500, "failed", None, None

        with patch("app.main.forward_webhook", fake_forward_webhook):
            replay_response = self.client.post(
                self.path_for(
                    "replay_event",
                    session_id=session_id,
                    event_id=capture["id"],
                ),
                headers=self.auth_headers(config["auth_token"]),
            )

        self.assertEqual(replay_response.status_code, 502)
        self.assertIn("status 500", replay_response.json()["detail"])
        events_response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id),
            headers=self.auth_headers(config["auth_token"]),
        )
        events = events_response.json()
        replay_events = [event for event in events if event["method"] == "REPLAY"]
        self.assertEqual(len(replay_events), 1)
        self.assertEqual(replay_events[0]["forward_status"], 500)
        self.assertEqual(replay_events[0]["replay_target_event_id"], capture["id"])

    def test_forward_failure_kind_and_delivery_status_are_persisted(self):
        session_id = "smoke-forward-kind"
        config = self.configure_razorpay_session(session_id, "forward_kind_secret")
        update_response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={"forward_url": "http://8.8.8.8/webhook"},
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(update_response.status_code, 200)

        async def fake_forward_webhook(forward_url, body, headers=None, query_params=None):
            return None, None, "connection refused", "connection"

        with patch("app.main.forward_webhook", fake_forward_webhook):
            capture = self.capture_fixture_event(session_id, token=config["auth_token"])

        event = asyncio.run(self.get_event(capture["id"]))
        self.assertEqual(event.forward_delivery_status, "delivery_failure")
        self.assertEqual(event.forward_failure_kind, "connection")

        events_response = self.client.get(
            self.path_for("get_webhooks", session_id=session_id),
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(events_response.status_code, 200)
        event_payload = events_response.json()[0]
        self.assertEqual(event_payload["forward_delivery_status"], "delivery_failure")
        self.assertEqual(event_payload["forward_failure_kind"], "connection")

    def test_forward_fire_and_forget_returns_before_background_result(self):
        session_id = "smoke-forward-fire-and-forget"
        config = self.configure_razorpay_session(session_id, "fire_and_forget_secret")
        update_response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={"forward_url": "http://8.8.8.8/webhook"},
            headers=self.auth_headers(config["auth_token"]),
        )
        self.assertEqual(update_response.status_code, 200)
        scheduled = []

        async def fake_forward_event_in_background(*args, **kwargs):
            scheduled.append(args[1])

        with patch.dict(os.environ, {"FORWARD_FIRE_AND_FORGET": "1"}):
            with patch("app.main.forward_event_in_background", fake_forward_event_in_background):
                capture = self.capture_fixture_event(session_id, token=config["auth_token"])

        self.assertEqual(capture["status"], "received")
        event = asyncio.run(self.get_event(capture["id"]))
        self.assertEqual(event.forward_delivery_status, "pending")


if __name__ == "__main__":
    unittest.main()
