import asyncio
import hashlib
import hmac
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from . import models
from .database import engine, get_db, Base
from .forwarding_diagnostics import build_forward_diagnostics, build_replay_forward_payload
from .razorpay_duplicates import find_duplicate_event_id_in_previous_events
from .razorpay_fixtures import build_fixture_event_diagnostics, build_razorpay_fixture_request
from .razorpay_metadata import RAZORPAY_METADATA_KEYS, extract_razorpay_metadata
from .schemas import WebhookEventOut, SessionConfigIn, SessionConfigOut, RazorpayFixtureRequestOut

Base.metadata.create_all(bind=engine)

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
TUNNEL_URL_FILE = "/shared/tunnel_url.txt"
HOP_BY_HOP_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}
PROVIDER_GENERIC = "generic"
PROVIDER_RAZORPAY = "razorpay"
RAZORPAY_EVENT_ID_HEADER = "x-razorpay-event-id"
RAZORPAY_SIGNATURE_HEADER = "x-razorpay-signature"


def ensure_session_config_columns() -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "ALTER TABLE session_configs "
                "ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'generic' NOT NULL"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE session_configs "
                "ADD COLUMN IF NOT EXISTS razorpay_webhook_secret TEXT"
            )
        )


ensure_session_config_columns()


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


def serialize_session_config(config: models.SessionConfig | None, session_id: str) -> SessionConfigOut:
    if not config:
        return SessionConfigOut(session_id=session_id)
    return SessionConfigOut(
        session_id=config.session_id,
        forward_url=config.forward_url,
        provider=normalize_provider(config.provider),
        razorpay_webhook_secret_configured=bool(config.razorpay_webhook_secret),
    )


def read_tunnel_url_file() -> str | None:
    try:
        with open(TUNNEL_URL_FILE, "r") as file:
            url = file.read().strip()
        return url or None
    except FileNotFoundError:
        return None


# ─── App Lifespan ─────────────────────────────────────────────────────────────
# Creates the Redis client once when the container starts.
# Closes it cleanly when the container stops.
# app.state.redis is then available anywhere in the app.

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    yield
    await app.state.redis.aclose()


app = FastAPI(title="HookRelay", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

public_ingress_router = APIRouter()
local_control_router = APIRouter()


# ─── Helper: Forward webhook to developer's app ──────────────────────────────

async def forward_webhook(
    forward_url: str,
    body: bytes | None,
    headers: dict | None = None,
    query_params: dict | None = None,
) -> tuple[int | None, str | None, str | None]:
    """
    POST the raw webhook body to the developer's real endpoint.
    Returns (status_code, response_body, error_message).
    """
    forward_headers = {}
    if headers:
        for key, value in headers.items():
            if key.lower() in HOP_BY_HOP_HEADERS:
                continue
            forward_headers[key] = value

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                forward_url,
                content=body or b"",
                headers=forward_headers,
                params=query_params or None,
            )
        return resp.status_code, resp.text[:2000], None
    except Exception as e:
        return None, None, str(e)[:500]


# ─── POST /hooks/{session_id} ─────────────────────────────────────────────────
# Receives a webhook, saves to PostgreSQL, publishes to Redis,
# and optionally forwards to the developer's real endpoint.

@public_ingress_router.post("/hooks/{session_id}", status_code=200)
async def receive_webhook(
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
):
    raw_body = await request.body()
    body_text = raw_body.decode("utf-8") if raw_body else None
    request_headers = dict(request.headers)
    request_query_params = dict(request.query_params)

    event = models.WebhookEvent(
        session_id=session_id,
        method=request.method,
        headers=request_headers,
        body=body_text,
        query_params=request_query_params,
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()

    # Publish the saved event to Redis channel "webhook:<session_id>"
    event_data = serialize_event(event, db, config)
    await request.app.state.redis.publish(
        f"webhook:{session_id}",
        json.dumps(event_data),
    )

    # Check if this session has a forwarding URL configured
    if config and config.forward_url:
        status, response, error = await forward_webhook(
            config.forward_url,
            raw_body,
            headers=request_headers,
            query_params=request_query_params,
        )
        event.forward_status = status
        event.forward_response = response
        event.forward_error = error
        event.forwarded_at = datetime.utcnow()
        db.commit()
        db.refresh(event)

        # Re-publish with forwarding data so the dashboard updates
        event_data = serialize_event(event, db, config)
        await request.app.state.redis.publish(
            f"webhook:{session_id}",
            json.dumps(event_data),
        )

    return {"status": "received", "id": event.id}


# ─── GET /hooks/{session_id} ──────────────────────────────────────────────────
# Returns full history from PostgreSQL — used when the dashboard first loads.

@local_control_router.get("/hooks/{session_id}", response_model=List[WebhookEventOut])
def get_webhooks(session_id: str, db: Session = Depends(get_db)):
    events = (
        db.query(models.WebhookEvent)
        .filter(models.WebhookEvent.session_id == session_id)
        .order_by(models.WebhookEvent.received_at.desc())
        .all()
    )
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    return [serialize_event(event, db, config) for event in events]


# ─── DELETE /hooks/{session_id} ───────────────────────────────────────────────

@local_control_router.delete("/hooks/{session_id}", status_code=200)
def clear_webhooks(session_id: str, db: Session = Depends(get_db)):
    deleted = (
        db.query(models.WebhookEvent)
        .filter(models.WebhookEvent.session_id == session_id)
        .delete()
    )
    db.commit()
    return {"status": "cleared", "deleted_count": deleted}


# ─── DELETE /sessions/{session_id} ────────────────────────────────────────────

@local_control_router.delete("/sessions/{session_id}", status_code=200)
def delete_session(session_id: str, db: Session = Depends(get_db)):
    # Delete all events
    db.query(models.WebhookEvent).filter(models.WebhookEvent.session_id == session_id).delete()
    # Delete config
    db.query(models.SessionConfig).filter(models.SessionConfig.session_id == session_id).delete()
    db.commit()
    return {"status": "deleted"}


# ─── POST /hooks/{session_id}/{event_id}/replay ──────────────────────────────
# Re-forwards a stored event to the session's configured forwarding URL.
# Creates a new event record so it shows up in the dashboard timeline.

@local_control_router.post("/hooks/{session_id}/{event_id}/replay", status_code=200)
async def replay_event(
    session_id: str,
    event_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    # Load the original event
    original = (
        db.query(models.WebhookEvent)
        .filter_by(id=event_id, session_id=session_id)
        .first()
    )
    if not original:
        raise HTTPException(status_code=404, detail="Event not found")

    # Load session config for forward URL
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    if not config or not config.forward_url:
        raise HTTPException(status_code=400, detail="No forwarding URL configured for this session")

    # Forward the original payload
    raw_body, replay_headers, replay_query_params = build_replay_forward_payload(original)
    status, response, error = await forward_webhook(
        config.forward_url,
        raw_body,
        headers=replay_headers,
        query_params=replay_query_params,
    )

    # Create a new event record for the replay
    replay_event = models.WebhookEvent(
        session_id=session_id,
        method="REPLAY",
        headers=original.headers or {},
        body=original.body,
        query_params=original.query_params,
        forward_status=status,
        forward_response=response,
        forward_error=error,
        forwarded_at=datetime.utcnow(),
    )
    db.add(replay_event)
    db.commit()
    db.refresh(replay_event)

    # Publish to dashboard
    event_data = serialize_event(replay_event, db, config)
    await request.app.state.redis.publish(
        f"webhook:{session_id}",
        json.dumps(event_data),
    )

    return {"status": "replayed", "id": replay_event.id, "forward_status": status}


# ─── WebSocket /ws/{session_id} ───────────────────────────────────────────────
# The browser connects here once and stays connected.
#
# How it works:
#   1. Browser opens WebSocket to /ws/my-session
#   2. We subscribe to Redis channel "webhook:my-session"
#   3. We run two async tasks in parallel:
#        - forward_task: listens to Redis, pushes every message to the browser
#        - disconnect_task: waits for the browser to close the connection
#   4. Whichever task finishes first (usually disconnect), we cancel the other
#   5. Clean up the Redis subscription

@local_control_router.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()

    # Each WebSocket connection gets its own Redis pubsub object
    pubsub = websocket.app.state.redis.pubsub()
    await pubsub.subscribe(f"webhook:{session_id}")

    async def forward_to_browser():
        """Read from Redis, send to browser."""
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"])

    async def wait_for_disconnect():
        """Block until the browser closes the connection."""
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass

    forward_task    = asyncio.create_task(forward_to_browser())
    disconnect_task = asyncio.create_task(wait_for_disconnect())

    # Wait for whichever finishes first
    _, pending = await asyncio.wait(
        [forward_task, disconnect_task],
        return_when=asyncio.FIRST_COMPLETED,
    )

    for task in pending:
        task.cancel()

    await pubsub.unsubscribe(f"webhook:{session_id}")
    await pubsub.aclose()


# ─── GET /sessions ──────────────────────────────────────────────────────────
# Returns all distinct session IDs ordered by most recent activity.
# Fetches from both WebhookEvents and SessionConfigs to ensure empty sessions with saved configs are not lost.

@local_control_router.get("/sessions")
def get_sessions(db: Session = Depends(get_db)):
    events = (
        db.query(models.WebhookEvent.session_id, func.max(models.WebhookEvent.received_at).label("last_active"))
        .group_by(models.WebhookEvent.session_id)
        .all()
    )
    
    configs = (
        db.query(models.SessionConfig.session_id, models.SessionConfig.updated_at.label("last_active"))
        .all()
    )
    
    session_dict = {}
    for r in events:
        session_dict[r.session_id] = r.last_active
        
    for r in configs:
        t = r.last_active or datetime.min
        if r.session_id not in session_dict or (session_dict[r.session_id] is None) or t > session_dict[r.session_id]:
            session_dict[r.session_id] = t
            
    sorted_sessions = sorted(session_dict.keys(), key=lambda k: session_dict[k] or datetime.min, reverse=True)
    return sorted_sessions


# ─── PUT /sessions/{session_id}/config ────────────────────────────────────────
# Save or update the forwarding URL for a session.

@local_control_router.put("/sessions/{session_id}/config", response_model=SessionConfigOut)
def update_session_config(
    session_id: str,
    config_in: SessionConfigIn,
    db: Session = Depends(get_db),
):
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    fields = config_in.model_fields_set

    if config:
        if "forward_url" in fields:
            config.forward_url = config_in.forward_url
        if "provider" in fields and config_in.provider is not None:
            config.provider = normalize_provider(config_in.provider)
        if "razorpay_webhook_secret" in fields:
            secret = (config_in.razorpay_webhook_secret or "").strip()
            config.razorpay_webhook_secret = secret or None
        config.updated_at = datetime.utcnow()
    else:
        secret = (config_in.razorpay_webhook_secret or "").strip()
        config = models.SessionConfig(
            session_id=session_id,
            forward_url=config_in.forward_url,
            provider=normalize_provider(config_in.provider),
            razorpay_webhook_secret=secret or None,
        )
        db.add(config)
    db.commit()
    db.refresh(config)
    return serialize_session_config(config, session_id)


# ─── GET /sessions/{session_id}/config ────────────────────────────────────────
# Get the forwarding URL for a session.

@local_control_router.get("/sessions/{session_id}/config", response_model=SessionConfigOut)
def get_session_config(session_id: str, db: Session = Depends(get_db)):
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    return serialize_session_config(config, session_id)


@local_control_router.post(
    "/sessions/{session_id}/razorpay-fixtures/{fixture_key}",
    response_model=RazorpayFixtureRequestOut,
)
def create_razorpay_fixture_request(
    session_id: str,
    fixture_key: str,
    db: Session = Depends(get_db),
):
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    secret = None
    if config and normalize_provider(config.provider) == PROVIDER_RAZORPAY:
        secret = config.razorpay_webhook_secret

    try:
        return build_razorpay_fixture_request(fixture_key, secret)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown Razorpay fixture")


# ─── GET /tunnel-url ──────────────────────────────────────────────────────────
# Returns the current Cloudflare tunnel URL if available.
# The tunnel container writes its URL to /shared/tunnel-url.txt.

@local_control_router.get("/tunnel-url")
def get_tunnel_url():
    return {"url": read_tunnel_url_file()}


# ─── GET /health ──────────────────────────────────────────────────────────────

@local_control_router.get("/health")
def health():
    return {"status": "ok"}


app.include_router(public_ingress_router)
app.include_router(local_control_router)
