import hashlib
import hmac
import json

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from . import models
from .forwarding_diagnostics import build_forward_diagnostics
from .razorpay_duplicates import find_duplicate_event_id_in_previous_events
from .razorpay_fixtures import build_fixture_event_diagnostics
from .razorpay_metadata import RAZORPAY_METADATA_KEYS, extract_razorpay_metadata
from .schemas import WebhookEventOut

PROVIDER_GENERIC = "generic"
PROVIDER_RAZORPAY = "razorpay"
RAZORPAY_EVENT_ID_HEADER = "x-razorpay-event-id"
RAZORPAY_SIGNATURE_HEADER = "x-razorpay-signature"


def normalize_provider(provider: str | None) -> str:
    if provider == PROVIDER_RAZORPAY:
        return PROVIDER_RAZORPAY
    return PROVIDER_GENERIC


def get_header(headers: dict | None, name: str) -> str | None:
    if not headers:
        return None
    expected = name.lower()
    for key, value in headers.items():
        if str(key).lower() == expected:
            return str(value)
    return None


def parse_json_body(body: str | None) -> dict | None:
    if not body:
        return None
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def verify_razorpay_signature(body: str | None, signature: str | None, secret: str | None) -> tuple[str, str]:
    if not secret:
        return "missing_secret", "Razorpay webhook secret is not configured."
    if not signature:
        return "missing_signature", "X-Razorpay-Signature header is missing."

    expected = hmac.new(
        secret.encode("utf-8"),
        (body or "").encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if hmac.compare_digest(expected, signature):
        return "valid", "Signature matches the configured Razorpay secret."
    return "invalid", "Signature does not match the configured Razorpay secret."


def find_duplicate_razorpay_event_id(
    db: Session,
    event: models.WebhookEvent,
    provider_event_id: str | None,
) -> int | None:
    if not provider_event_id:
        return None

    previous_events = (
        db.query(models.WebhookEvent)
        .filter(
            models.WebhookEvent.session_id == event.session_id,
            models.WebhookEvent.id < event.id,
        )
        .order_by(models.WebhookEvent.id.asc())
        .all()
    )
    return find_duplicate_event_id_in_previous_events(
        previous_events,
        provider_event_id,
        RAZORPAY_EVENT_ID_HEADER,
    )


def build_razorpay_diagnostics(
    event: models.WebhookEvent,
    config: models.SessionConfig | None,
    db: Session,
) -> dict:
    provider = normalize_provider(getattr(config, "provider", None))
    diagnostics = {
        "provider": provider,
        "provider_event_id": None,
        "signature_status": "not_applicable",
        "signature_message": "Razorpay mode is not enabled for this endpoint.",
        "duplicate_of_id": None,
        **RAZORPAY_METADATA_KEYS,
    }
    if provider != PROVIDER_RAZORPAY:
        return diagnostics

    payload = parse_json_body(event.body)
    metadata = extract_razorpay_metadata(payload)

    provider_event_id = get_header(event.headers, RAZORPAY_EVENT_ID_HEADER)
    signature = get_header(event.headers, RAZORPAY_SIGNATURE_HEADER)
    secret = getattr(config, "razorpay_webhook_secret", None)
    signature_status, signature_message = verify_razorpay_signature(event.body, signature, secret)

    diagnostics.update(
        {
            **metadata,
            "provider_event_id": provider_event_id,
            "signature_status": signature_status,
            "signature_message": signature_message,
            "duplicate_of_id": find_duplicate_razorpay_event_id(db, event, provider_event_id),
        }
    )
    return diagnostics


def serialize_event(
    event: models.WebhookEvent,
    db: Session,
    config: models.SessionConfig | None = None,
) -> dict:
    if config is None:
        config = (
            db.query(models.SessionConfig)
            .filter(models.SessionConfig.session_id == event.session_id)
            .first()
        )
    data = WebhookEventOut.model_validate(event).model_dump()
    data.update(build_forward_diagnostics(event, forward_url_configured=bool(config and config.forward_url)))
    data.update(build_razorpay_diagnostics(event, config, db))
    data.update(build_fixture_event_diagnostics(event))
    return jsonable_encoder(data)
