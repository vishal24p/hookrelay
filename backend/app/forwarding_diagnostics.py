def build_forward_diagnostics(event, forward_url_configured: bool = False) -> dict:
    forward_error = getattr(event, "forward_error", None)
    forward_status = getattr(event, "forward_status", None)

    if forward_error:
        return {
            "forward_delivery_status": "delivery_failure",
            "forward_delivery_message": "HookRelay could not deliver the webhook to the local handler.",
        }

    if forward_status is None:
        if forward_url_configured:
            return {
                "forward_delivery_status": "pending",
                "forward_delivery_message": "HookRelay is forwarding this event to the configured local handler.",
            }
        return {
            "forward_delivery_status": "not_forwarded",
            "forward_delivery_message": "No forwarding attempt is recorded for this event.",
        }

    if 200 <= forward_status < 300:
        return {
            "forward_delivery_status": "success",
            "forward_delivery_message": "Local handler returned 2xx. Razorpay should treat this delivery as successful.",
        }

    return {
        "forward_delivery_status": "retry_risk",
        "forward_delivery_message": "Local handler returned non-2xx. Razorpay may retry this webhook.",
    }


def build_replay_forward_payload(event) -> tuple[bytes, dict | None, dict | None]:
    body = getattr(event, "body", None)
    headers = getattr(event, "headers", None)
    query_params = getattr(event, "query_params", None)

    return (
        body.encode("utf-8") if body else b"",
        headers if isinstance(headers, dict) else None,
        query_params if isinstance(query_params, dict) else None,
    )
