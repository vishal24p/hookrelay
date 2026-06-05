import unittest
from types import SimpleNamespace

from backend.app.forwarding_diagnostics import (
    build_forward_diagnostics,
    build_replay_forward_payload,
)


class ForwardingDiagnosticsTests(unittest.TestCase):
    def test_2xx_status_is_success(self):
        event = SimpleNamespace(forward_status=200, forward_error=None)

        diagnostics = build_forward_diagnostics(event)

        self.assertEqual(diagnostics["forward_delivery_status"], "success")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "Local handler returned 2xx. Razorpay should treat this delivery as successful.",
        )

    def test_non_2xx_status_is_retry_risk(self):
        event = SimpleNamespace(forward_status=500, forward_error=None)

        diagnostics = build_forward_diagnostics(event)

        self.assertEqual(diagnostics["forward_delivery_status"], "retry_risk")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "Local handler returned non-2xx. Razorpay may retry this webhook.",
        )

    def test_forward_error_is_delivery_failure(self):
        event = SimpleNamespace(forward_status=None, forward_error="ConnectError")

        diagnostics = build_forward_diagnostics(event)

        self.assertEqual(diagnostics["forward_delivery_status"], "delivery_failure")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "HookRelay could not deliver the webhook to the local handler.",
        )

    def test_missing_forward_status_is_not_forwarded(self):
        event = SimpleNamespace(forward_status=None, forward_error=None)

        diagnostics = build_forward_diagnostics(event)

        self.assertEqual(diagnostics["forward_delivery_status"], "not_forwarded")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "No forwarding attempt is recorded for this event.",
        )

    def test_configured_forward_without_result_is_pending(self):
        event = SimpleNamespace(forward_status=None, forward_error=None)

        diagnostics = build_forward_diagnostics(event, forward_url_configured=True)

        self.assertEqual(diagnostics["forward_delivery_status"], "pending")
        self.assertEqual(
            diagnostics["forward_delivery_message"],
            "HookRelay is forwarding this event to the configured local handler.",
        )

    def test_replay_payload_uses_original_body_headers_and_query_params(self):
        event = SimpleNamespace(
            body='{"event":"payment.captured"}',
            headers={"X-Razorpay-Event-Id": "evt_replay"},
            query_params={"source": "manual"},
        )

        body, headers, query_params = build_replay_forward_payload(event)

        self.assertEqual(body, b'{"event":"payment.captured"}')
        self.assertEqual(headers, {"X-Razorpay-Event-Id": "evt_replay"})
        self.assertEqual(query_params, {"source": "manual"})

    def test_replay_payload_ignores_non_dict_headers_and_query_params(self):
        event = SimpleNamespace(body=None, headers=[], query_params="bad")

        body, headers, query_params = build_replay_forward_payload(event)

        self.assertEqual(body, b"")
        self.assertIsNone(headers)
        self.assertIsNone(query_params)


if __name__ == "__main__":
    unittest.main()
