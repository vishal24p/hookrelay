import unittest
from types import SimpleNamespace

from backend.app.razorpay_duplicates import find_duplicate_event_id_in_previous_events


class RazorpayDuplicateTests(unittest.TestCase):
    def test_returns_first_previous_event_with_same_event_id(self):
        previous_events = [
            SimpleNamespace(id=10, headers={"x-razorpay-event-id": "evt_same"}),
            SimpleNamespace(id=11, headers={"x-razorpay-event-id": "evt_same"}),
        ]

        duplicate_id = find_duplicate_event_id_in_previous_events(
            previous_events,
            "evt_same",
            "x-razorpay-event-id",
        )

        self.assertEqual(duplicate_id, 10)

    def test_header_lookup_is_case_insensitive(self):
        previous_events = [
            SimpleNamespace(id=20, headers={"X-Razorpay-Event-Id": "evt_case"}),
        ]

        duplicate_id = find_duplicate_event_id_in_previous_events(
            previous_events,
            "evt_case",
            "x-razorpay-event-id",
        )

        self.assertEqual(duplicate_id, 20)

    def test_returns_none_without_provider_event_id(self):
        previous_events = [
            SimpleNamespace(id=30, headers={"x-razorpay-event-id": "evt_present"}),
        ]

        duplicate_id = find_duplicate_event_id_in_previous_events(
            previous_events,
            None,
            "x-razorpay-event-id",
        )

        self.assertIsNone(duplicate_id)

    def test_returns_none_when_no_previous_event_matches(self):
        previous_events = [
            SimpleNamespace(id=40, headers={"x-razorpay-event-id": "evt_other"}),
            SimpleNamespace(id=41, headers={}),
        ]

        duplicate_id = find_duplicate_event_id_in_previous_events(
            previous_events,
            "evt_current",
            "x-razorpay-event-id",
        )

        self.assertIsNone(duplicate_id)


if __name__ == "__main__":
    unittest.main()
