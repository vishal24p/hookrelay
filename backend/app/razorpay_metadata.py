RAZORPAY_METADATA_KEYS = {
    "provider_event_type": None,
    "razorpay_payment_id": None,
    "razorpay_order_id": None,
    "razorpay_refund_id": None,
    "razorpay_subscription_id": None,
}


def _string_at(value: dict | None, path: tuple[str, ...]) -> str | None:
    current = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current if isinstance(current, str) else None


def _first_string(value: dict | None, paths: tuple[tuple[str, ...], ...]) -> str | None:
    for path in paths:
        result = _string_at(value, path)
        if result:
            return result
    return None


def extract_razorpay_metadata(body: dict | None) -> dict[str, str | None]:
    if not isinstance(body, dict):
        return dict(RAZORPAY_METADATA_KEYS)

    metadata = dict(RAZORPAY_METADATA_KEYS)
    metadata.update(
        {
            "provider_event_type": _string_at(body, ("event",)),
            "razorpay_payment_id": _first_string(
                body,
                (
                    ("payload", "payment", "entity", "id"),
                    ("payload", "refund", "entity", "payment_id"),
                ),
            ),
            "razorpay_order_id": _first_string(
                body,
                (
                    ("payload", "order", "entity", "id"),
                    ("payload", "payment", "entity", "order_id"),
                    ("payload", "refund", "entity", "order_id"),
                ),
            ),
            "razorpay_refund_id": _string_at(body, ("payload", "refund", "entity", "id")),
            "razorpay_subscription_id": _first_string(
                body,
                (
                    ("payload", "subscription", "entity", "id"),
                    ("payload", "payment", "entity", "subscription_id"),
                ),
            ),
        }
    )
    return metadata
