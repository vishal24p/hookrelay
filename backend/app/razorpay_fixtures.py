import hashlib
import hmac
import json
import time
import uuid
from copy import deepcopy


RAZORPAY_FIXTURE_KEYS = [
    "payment_captured",
    "payment_failed",
    "order_paid",
    "refund_processed",
    "subscription_charged",
]

FIXTURE_LABELS = {
    "payment_captured": "Payment captured",
    "payment_failed": "Payment failed",
    "order_paid": "Order paid",
    "refund_processed": "Refund processed",
    "subscription_charged": "Subscription charged",
}


def _header_value(headers: dict | None, name: str) -> str | None:
    if not headers:
        return None
    expected = name.lower()
    for key, value in headers.items():
        if str(key).lower() == expected:
            return str(value)
    return None


def _ids(suffix: str) -> dict:
    return {
        "account": f"acc_{suffix}",
        "event": f"evt_{suffix}",
        "payment": f"pay_{suffix}",
        "order": f"order_{suffix}",
        "refund": f"rfnd_{suffix}",
        "subscription": f"sub_{suffix}",
    }


def _payment_entity(ids: dict, created_at: int, status: str, captured: bool) -> dict:
    return {
        "id": ids["payment"],
        "entity": "payment",
        "amount": 50000,
        "currency": "INR",
        "status": status,
        "order_id": ids["order"],
        "invoice_id": None,
        "international": False,
        "method": "card",
        "amount_refunded": 0,
        "refund_status": None,
        "captured": captured,
        "description": "HookRelay local fixture payment",
        "card_id": "card_fixture",
        "bank": None,
        "wallet": None,
        "vpa": None,
        "email": "dev@example.com",
        "contact": "+919999999999",
        "notes": {"source": "hookrelay_fixture"},
        "fee": None,
        "tax": None,
        "error_code": None if captured else "BAD_REQUEST_ERROR",
        "error_description": None if captured else "Payment failed in local fixture",
        "created_at": created_at,
    }


def _order_entity(ids: dict, created_at: int, status: str = "paid") -> dict:
    return {
        "id": ids["order"],
        "entity": "order",
        "amount": 50000,
        "amount_paid": 50000 if status == "paid" else 0,
        "amount_due": 0 if status == "paid" else 50000,
        "currency": "INR",
        "receipt": "hookrelay_fixture_receipt",
        "offer_id": None,
        "status": status,
        "attempts": 1,
        "notes": {"source": "hookrelay_fixture"},
        "created_at": created_at,
    }


def _refund_entity(ids: dict, created_at: int) -> dict:
    return {
        "id": ids["refund"],
        "entity": "refund",
        "amount": 50000,
        "currency": "INR",
        "payment_id": ids["payment"],
        "notes": {"source": "hookrelay_fixture"},
        "receipt": "hookrelay_fixture_refund",
        "status": "processed",
        "speed_processed": "normal",
        "speed_requested": "normal",
        "created_at": created_at,
    }


def _subscription_entity(ids: dict, created_at: int) -> dict:
    return {
        "id": ids["subscription"],
        "entity": "subscription",
        "plan_id": "plan_hookrelay_fixture",
        "customer_id": "cust_hookrelay_fixture",
        "status": "active",
        "current_start": created_at,
        "current_end": created_at + 2592000,
        "ended_at": None,
        "quantity": 1,
        "notes": {"source": "hookrelay_fixture"},
        "charge_at": created_at + 2592000,
        "start_at": created_at,
        "end_at": None,
        "auth_attempts": 0,
        "total_count": 12,
        "paid_count": 1,
        "customer_notify": True,
        "created_at": created_at,
    }


def _base_event(event_type: str, contains: list[str], ids: dict, created_at: int, payload: dict) -> dict:
    return {
        "entity": "event",
        "account_id": ids["account"],
        "event": event_type,
        "contains": contains,
        "payload": payload,
        "created_at": created_at,
    }


def _fixture_body(fixture_key: str, suffix: str, created_at: int) -> dict:
    ids = _ids(suffix)
    if fixture_key == "payment_captured":
        return _base_event(
            "payment.captured",
            ["payment"],
            ids,
            created_at,
            {"payment": {"entity": _payment_entity(ids, created_at, "captured", True)}},
        )
    if fixture_key == "payment_failed":
        return _base_event(
            "payment.failed",
            ["payment"],
            ids,
            created_at,
            {"payment": {"entity": _payment_entity(ids, created_at, "failed", False)}},
        )
    if fixture_key == "order_paid":
        return _base_event(
            "order.paid",
            ["order", "payment"],
            ids,
            created_at,
            {
                "order": {"entity": _order_entity(ids, created_at)},
                "payment": {"entity": _payment_entity(ids, created_at, "captured", True)},
            },
        )
    if fixture_key == "refund_processed":
        return _base_event(
            "refund.processed",
            ["refund", "payment"],
            ids,
            created_at,
            {
                "refund": {"entity": _refund_entity(ids, created_at)},
                "payment": {"entity": _payment_entity(ids, created_at, "captured", True)},
            },
        )
    if fixture_key == "subscription_charged":
        return _base_event(
            "subscription.charged",
            ["subscription", "payment"],
            ids,
            created_at,
            {
                "subscription": {"entity": _subscription_entity(ids, created_at)},
                "payment": {
                    "entity": {
                        **_payment_entity(ids, created_at, "captured", True),
                        "subscription_id": ids["subscription"],
                    }
                },
            },
        )
    raise ValueError(f"Unknown Razorpay fixture: {fixture_key}")


def build_razorpay_fixture_request(
    fixture_key: str,
    secret: str | None,
    suffix: str | None = None,
    created_at: int | None = None,
) -> dict:
    if fixture_key not in RAZORPAY_FIXTURE_KEYS:
        raise ValueError(f"Unknown Razorpay fixture: {fixture_key}")

    suffix = suffix or uuid.uuid4().hex[:12]
    created_at = created_at or int(time.time())
    body = deepcopy(_fixture_body(fixture_key, suffix, created_at))
    body_text = json.dumps(body, separators=(",", ":"))

    headers = {
        "Content-Type": "application/json",
        "X-HookRelay-Fixture": "razorpay-local",
        "X-HookRelay-Fixture-Key": fixture_key,
        "X-Razorpay-Event-Id": f"evt_{suffix}",
    }
    if secret:
        headers["X-Razorpay-Signature"] = hmac.new(
            secret.encode("utf-8"),
            body_text.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    return {
        "fixture_key": fixture_key,
        "label": FIXTURE_LABELS[fixture_key],
        "headers": headers,
        "body": body_text,
        "signature_generated": bool(secret),
    }


def build_fixture_event_diagnostics(event) -> dict:
    source = _header_value(getattr(event, "headers", None), "x-hookrelay-fixture")
    key = _header_value(getattr(event, "headers", None), "x-hookrelay-fixture-key")
    return {
        "is_local_fixture": bool(source),
        "fixture_source": source,
        "fixture_key": key,
    }
