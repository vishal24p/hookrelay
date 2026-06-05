import inspect
import os
import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ["DATABASE_URL"] = "sqlite://"

from app.main import (  # noqa: E402
    ensure_session_config_columns,
    ensure_webhook_event_columns,
    forward_url_warnings,
    publish_event_update,
    websocket_endpoint,
)


class HardeningContractTests(unittest.TestCase):
    def test_websocket_handler_uses_bounded_pubsub_with_heartbeat(self):
        source = inspect.getsource(websocket_endpoint)
        self.assertNotIn("pubsub.listen()", source)
        self.assertIn("get_message", source)
        self.assertIn("heartbeat", source)
        self.assertIn("asyncio.wait_for", source)
        self.assertIn("RedisError", source)

    def test_publish_failures_are_logged_without_crashing_request_flow(self):
        source = inspect.getsource(publish_event_update)
        self.assertIn("redis.publish_failed", source)
        self.assertIn("RedisError", source)
        self.assertIn("logger.warning", source)

    def test_schema_maintenance_warns_on_statement_failure(self):
        session_source = inspect.getsource(ensure_session_config_columns)
        event_source = inspect.getsource(ensure_webhook_event_columns)
        self.assertIn("logger.warning", session_source)
        self.assertIn("logger.warning", event_source)
        self.assertIn("ensure_column_failed", session_source)
        self.assertIn("ensure_column_failed", event_source)

    def test_forward_url_warnings_identify_docker_and_loopback_hosts(self):
        self.assertTrue(
            any("host.docker.internal" in warning for warning in forward_url_warnings("http://host.docker.internal:3000/hook"))
        )
        self.assertTrue(
            any("loopback" in warning.lower() for warning in forward_url_warnings("http://127.0.0.1:3000/hook"))
        )


if __name__ == "__main__":
    unittest.main()
