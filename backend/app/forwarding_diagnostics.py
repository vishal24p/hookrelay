FORWARD_STATUS_NOT_FORWARDED = "not_forwarded"
FORWARD_STATUS_PENDING = "pending"
FORWARD_STATUS_SUCCESS = "success"
FORWARD_STATUS_RETRY_RISK = "retry_risk"
FORWARD_STATUS_DELIVERY_FAILURE = "delivery_failure"

FORWARD_FAILURE_MESSAGES = {
    "timeout": "Local handler timed out. Check that the process is running and responding.",
    "connection": "HookRelay could not connect to the local handler.",
    "tls": "TLS negotiation failed while forwarding to the local handler.",
    "dns": "Forward URL host could not be resolved.",
    "invalid_url": "Forward URL is not allowed or is invalid.",
    "other": "HookRelay could not deliver the webhook to the local handler.",
}


def delivery_status_from_forward_result(forward_status, forward_error=None) -> str:
    if forward_error:
        return FORWARD_STATUS_DELIVERY_FAILURE
    if forward_status is None:
        return FORWARD_STATUS_NOT_FORWARDED
    if 200 <= forward_status < 300:
        return FORWARD_STATUS_SUCCESS
    return FORWARD_STATUS_RETRY_RISK


def build_forward_diagnostics(event, forward_url_configured: bool = False) -> dict:
    forward_error = getattr(event, "forward_error", None)
    forward_status = getattr(event, "forward_status", None)
    persisted_status = getattr(event, "forward_delivery_status", None)
    failure_kind = getattr(event, "forward_failure_kind", None)

    if persisted_status == FORWARD_STATUS_DELIVERY_FAILURE or forward_error:
        return {
            "forward_delivery_status": FORWARD_STATUS_DELIVERY_FAILURE,
            "forward_delivery_message": FORWARD_FAILURE_MESSAGES.get(
                failure_kind,
                FORWARD_FAILURE_MESSAGES["other"],
            ),
        }

    if persisted_status == FORWARD_STATUS_PENDING:
        return {
            "forward_delivery_status": FORWARD_STATUS_PENDING,
            "forward_delivery_message": "HookRelay is forwarding this event to the configured local handler.",
        }

    if persisted_status == FORWARD_STATUS_NOT_FORWARDED or forward_status is None:
        if forward_url_configured:
            return {
                "forward_delivery_status": FORWARD_STATUS_PENDING,
                "forward_delivery_message": "HookRelay is forwarding this event to the configured local handler.",
            }
        return {
            "forward_delivery_status": FORWARD_STATUS_NOT_FORWARDED,
            "forward_delivery_message": "No forwarding attempt is recorded for this event.",
        }

    if persisted_status == FORWARD_STATUS_SUCCESS or 200 <= forward_status < 300:
        return {
            "forward_delivery_status": FORWARD_STATUS_SUCCESS,
            "forward_delivery_message": "Local handler returned 2xx. Razorpay should treat this delivery as successful.",
        }

    return {
        "forward_delivery_status": FORWARD_STATUS_RETRY_RISK,
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
