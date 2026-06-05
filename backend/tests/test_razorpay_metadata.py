import unittest

from backend.app.razorpay_metadata import extract_razorpay_metadata


class RazorpayMetadataTests(unittest.TestCase):
    def test_payment_captured_extracts_event_type_payment_id_and_order_id(self):
        body = {
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_123",
                        "order_id": "order_123",
                    }
                }
            },
        }

        metadata = extract_razorpay_metadata(body)

        self.assertEqual(metadata["provider_event_type"], "payment.captured")
        self.assertEqual(metadata["razorpay_payment_id"], "pay_123")
        self.assertEqual(metadata["razorpay_order_id"], "order_123")

    def test_order_paid_extracts_event_type_and_order_id(self):
        body = {
            "event": "order.paid",
            "payload": {
                "order": {
                    "entity": {
                        "id": "order_456",
                    }
                }
            },
        }

        metadata = extract_razorpay_metadata(body)

        self.assertEqual(metadata["provider_event_type"], "order.paid")
        self.assertEqual(metadata["razorpay_order_id"], "order_456")
        self.assertIsNone(metadata["razorpay_payment_id"])

    def test_refund_payload_extracts_refund_id_and_payment_id(self):
        body = {
            "event": "refund.processed",
            "payload": {
                "refund": {
                    "entity": {
                        "id": "rfnd_123",
                        "payment_id": "pay_456",
                        "order_id": "order_789",
                    }
                }
            },
        }

        metadata = extract_razorpay_metadata(body)

        self.assertEqual(metadata["razorpay_refund_id"], "rfnd_123")
        self.assertEqual(metadata["razorpay_payment_id"], "pay_456")
        self.assertEqual(metadata["razorpay_order_id"], "order_789")

    def test_subscription_payload_extracts_subscription_id(self):
        body = {
            "event": "subscription.charged",
            "payload": {
                "subscription": {
                    "entity": {
                        "id": "sub_123",
                    }
                }
            },
        }

        metadata = extract_razorpay_metadata(body)

        self.assertEqual(metadata["provider_event_type"], "subscription.charged")
        self.assertEqual(metadata["razorpay_subscription_id"], "sub_123")

    def test_subscription_id_falls_back_to_payment_entity(self):
        body = {
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_789",
                        "subscription_id": "sub_456",
                    }
                }
            },
        }

        metadata = extract_razorpay_metadata(body)

        self.assertEqual(metadata["razorpay_payment_id"], "pay_789")
        self.assertEqual(metadata["razorpay_subscription_id"], "sub_456")

    def test_missing_optional_ids_return_none(self):
        metadata = extract_razorpay_metadata({"event": "payment.failed", "payload": {}})

        self.assertEqual(metadata["provider_event_type"], "payment.failed")
        self.assertIsNone(metadata["razorpay_payment_id"])
        self.assertIsNone(metadata["razorpay_order_id"])
        self.assertIsNone(metadata["razorpay_refund_id"])
        self.assertIsNone(metadata["razorpay_subscription_id"])

    def test_invalid_input_shapes_return_none_fields(self):
        for body in (None, [], "not-json", {"event": 123, "payload": []}):
            metadata = extract_razorpay_metadata(body)

            self.assertIsNone(metadata["provider_event_type"])
            self.assertIsNone(metadata["razorpay_payment_id"])
            self.assertIsNone(metadata["razorpay_order_id"])
            self.assertIsNone(metadata["razorpay_refund_id"])
            self.assertIsNone(metadata["razorpay_subscription_id"])


if __name__ == "__main__":
    unittest.main()
