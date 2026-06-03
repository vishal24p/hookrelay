import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["DATABASE_URL"] = "sqlite://"

from app import models
from app.database import get_db
from app.main import app


class FakeRedis:
    def __init__(self):
        self.messages = []

    async def publish(self, channel, message):
        self.messages.append((channel, message))
        return 1


class ApiSmokeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        self.SessionLocal = sessionmaker(
            autocommit=False,
            autoflush=False,
            bind=self.engine,
        )
        models.Base.metadata.create_all(bind=self.engine)

        def override_get_db():
            db = self.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        app.state.redis = FakeRedis()
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        self.engine.dispose()

    def path_for(self, route_name, **params):
        return str(app.url_path_for(route_name, **params))

    def configure_razorpay_session(self, session_id="smoke-session", secret="smoke_secret"):
        response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={
                "provider": "razorpay",
                "razorpay_webhook_secret": secret,
            },
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def fixture_request(self, session_id="smoke-session"):
        response = self.client.post(
            self.path_for(
                "create_razorpay_fixture_request",
                session_id=session_id,
                fixture_key="payment_captured",
            )
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def capture_fixture_event(self, session_id="smoke-session", event_id=None):
        fixture = self.fixture_request(session_id)
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

        put_response = self.client.put(
            self.path_for("update_session_config", session_id=session_id),
            json={
                "provider": "razorpay",
                "razorpay_webhook_secret": secret,
            },
        )

        self.assertEqual(put_response.status_code, 200)
        saved = put_response.json()
        self.assertEqual(saved["session_id"], session_id)
        self.assertEqual(saved["provider"], "razorpay")
        self.assertTrue(saved["razorpay_webhook_secret_configured"])
        self.assertNotIn("razorpay_webhook_secret", saved)
        self.assertNotIn(secret, json.dumps(saved))

        get_response = self.client.get(
            self.path_for("get_session_config", session_id=session_id)
        )

        self.assertEqual(get_response.status_code, 200)
        loaded = get_response.json()
        self.assertEqual(loaded["provider"], "razorpay")
        self.assertTrue(loaded["razorpay_webhook_secret_configured"])
        self.assertNotIn("razorpay_webhook_secret", loaded)
        self.assertNotIn(secret, json.dumps(loaded))

    def test_razorpay_fixture_generation_uses_configured_secret(self):
        self.configure_razorpay_session("smoke-fixture", "fixture_secret")

        fixture = self.fixture_request("smoke-fixture")

        self.assertEqual(fixture["fixture_key"], "payment_captured")
        self.assertTrue(fixture["signature_generated"])
        self.assertIsInstance(fixture["headers"], dict)
        self.assertIn("X-Razorpay-Signature", fixture["headers"])
        self.assertEqual(fixture["headers"]["X-HookRelay-Fixture-Key"], "payment_captured")
        body = json.loads(fixture["body"])
        self.assertEqual(body["event"], "payment.captured")

    def test_webhook_capture_stores_event_and_returns_received_id(self):
        self.configure_razorpay_session("smoke-capture", "capture_secret")

        capture = self.capture_fixture_event("smoke-capture")

        self.assertEqual(capture["status"], "received")
        self.assertIsInstance(capture["id"], int)

        events_response = self.client.get(
            self.path_for("get_webhooks", session_id="smoke-capture")
        )
        self.assertEqual(events_response.status_code, 200)
        events = events_response.json()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["id"], capture["id"])
        self.assertEqual(events[0]["provider"], "razorpay")
        self.assertEqual(events[0]["signature_status"], "valid")
        self.assertEqual(events[0]["provider_event_type"], "payment.captured")

    def test_duplicate_detection_across_two_razorpay_captures(self):
        self.configure_razorpay_session("smoke-duplicate", "duplicate_secret")
        duplicate_event_id = "evt_duplicate_smoke"

        first = self.capture_fixture_event("smoke-duplicate", duplicate_event_id)
        second = self.capture_fixture_event("smoke-duplicate", duplicate_event_id)

        events_response = self.client.get(
            self.path_for("get_webhooks", session_id="smoke-duplicate")
        )
        self.assertEqual(events_response.status_code, 200)
        events = events_response.json()
        self.assertEqual(len(events), 2)

        by_id = {event["id"]: event for event in events}
        self.assertIsNone(by_id[first["id"]]["duplicate_of_id"])
        self.assertEqual(by_id[second["id"]]["duplicate_of_id"], first["id"])

    def test_replay_requires_existing_event_and_forward_url(self):
        self.configure_razorpay_session("smoke-replay", "replay_secret")

        missing_response = self.client.post(
            self.path_for(
                "replay_event",
                session_id="smoke-replay",
                event_id=999,
            )
        )
        self.assertEqual(missing_response.status_code, 404)

        capture = self.capture_fixture_event("smoke-replay")
        no_forward_response = self.client.post(
            self.path_for(
                "replay_event",
                session_id="smoke-replay",
                event_id=capture["id"],
            )
        )
        self.assertEqual(no_forward_response.status_code, 400)
        self.assertEqual(
            no_forward_response.json()["detail"],
            "No forwarding URL configured for this session",
        )

    def test_replay_with_configured_forward_url_uses_local_forwarder_patch(self):
        session_id = "smoke-replay-forward"
        self.configure_razorpay_session(session_id, "replay_forward_secret")
        capture_fixture_event_id = "evt_replay_forward"
        original = self.fixture_request(session_id)
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
                "forward_url": "http://127.0.0.1:9999/webhook",
            },
        )

        async def fake_forward_webhook(forward_url, body, headers=None, query_params=None):
            self.assertEqual(forward_url, "http://127.0.0.1:9999/webhook")
            self.assertTrue(body)
            self.assertEqual(headers["x-razorpay-event-id"], capture_fixture_event_id)
            return 202, "accepted", None

        with patch("app.main.forward_webhook", fake_forward_webhook):
            replay_response = self.client.post(
                self.path_for(
                    "replay_event",
                    session_id=session_id,
                    event_id=capture_response.json()["id"],
                )
            )

        self.assertEqual(replay_response.status_code, 200)
        replay = replay_response.json()
        self.assertEqual(replay["status"], "replayed")
        self.assertEqual(replay["forward_status"], 202)
        self.assertNotEqual(replay["id"], capture_response.json()["id"])


if __name__ == "__main__":
    unittest.main()
