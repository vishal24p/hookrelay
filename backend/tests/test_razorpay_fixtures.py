import hashlib
import hmac
import json
import unittest
from types import SimpleNamespace

from backend.app.razorpay_fixtures import (
    RAZORPAY_FIXTURE_KEYS,
    build_fixture_event_diagnostics,
    build_razorpay_fixture_request,
)


class RazorpayFixtureTests(unittest.TestCase):
    def test_catalog_has_required_fixture_keys(self):
        self.assertEqual(
            RAZORPAY_FIXTURE_KEYS,
            [
                "payment_captured",
                "payment_failed",
                "order_paid",
                "refund_processed",
                "subscription_charged",
            ],
        )

    def test_payment_captured_fixture_has_razorpay_shape(self):
        fixture = build_razorpay_fixture_request(
            "payment_captured",
            secret=None,
            suffix="fixed",
            created_at=1700000000,
        )

        body = json.loads(fixture["body"])

        self.assertEqual(body["entity"], "event")
        self.assertEqual(body["event"], "payment.captured")
        self.assertEqual(body["contains"], ["payment"])
        self.assertEqual(body["payload"]["payment"]["entity"]["id"], "pay_fixed")
        self.assertEqual(fixture["headers"]["X-Razorpay-Event-Id"], "evt_fixed")
        self.assertEqual(fixture["headers"]["X-HookRelay-Fixture"], "razorpay-local")
        self.assertEqual(fixture["headers"]["X-HookRelay-Fixture-Key"], "payment_captured")

    def test_all_fixtures_produce_expected_event_types(self):
        expected = {
            "payment_captured": "payment.captured",
            "payment_failed": "payment.failed",
            "order_paid": "order.paid",
            "refund_processed": "refund.processed",
            "subscription_charged": "subscription.charged",
        }

        for fixture_key, event_type in expected.items():
            with self.subTest(fixture_key=fixture_key):
                fixture = build_razorpay_fixture_request(
                    fixture_key,
                    secret=None,
                    suffix="fixed",
                    created_at=1700000000,
                )
                body = json.loads(fixture["body"])

                self.assertEqual(body["event"], event_type)

    def test_secret_generates_signature_from_exact_body(self):
        fixture = build_razorpay_fixture_request(
            "order_paid",
            secret="whsec_test",
            suffix="fixed",
            created_at=1700000000,
        )

        expected_signature = hmac.new(
            b"whsec_test",
            fixture["body"].encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        self.assertEqual(fixture["headers"]["X-Razorpay-Signature"], expected_signature)
        self.assertTrue(fixture["signature_generated"])

    def test_without_secret_omits_signature(self):
        fixture = build_razorpay_fixture_request(
            "refund_processed",
            secret=None,
            suffix="fixed",
            created_at=1700000000,
        )

        self.assertNotIn("X-Razorpay-Signature", fixture["headers"])
        self.assertFalse(fixture["signature_generated"])

    def test_unknown_fixture_key_raises_value_error(self):
        with self.assertRaises(ValueError):
            build_razorpay_fixture_request(
                "unknown",
                secret=None,
                suffix="fixed",
                created_at=1700000000,
            )

    def test_fixture_event_diagnostics_reads_headers_case_insensitively(self):
        event = SimpleNamespace(
            headers={
                "x-hookrelay-fixture": "razorpay-local",
                "X-HookRelay-Fixture-Key": "payment_failed",
            }
        )

        diagnostics = build_fixture_event_diagnostics(event)

        self.assertTrue(diagnostics["is_local_fixture"])
        self.assertEqual(diagnostics["fixture_source"], "razorpay-local")
        self.assertEqual(diagnostics["fixture_key"], "payment_failed")


if __name__ == "__main__":
    unittest.main()
