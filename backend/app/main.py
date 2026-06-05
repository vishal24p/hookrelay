import asyncio
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import secrets
import socket
import ssl
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
import redis.asyncio as aioredis
import redis.exceptions
from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from . import models
from .database import engine, get_db, SessionLocal
from .event_serialization import (
    PROVIDER_RAZORPAY,
    RAZORPAY_SIGNATURE_HEADER,
    get_header,
    normalize_provider,
    serialize_event,
    verify_razorpay_signature,
)
from .forwarding_diagnostics import (
    FORWARD_STATUS_NOT_FORWARDED,
    FORWARD_STATUS_PENDING,
    delivery_status_from_forward_result,
    build_replay_forward_payload,
)
from .razorpay_fixtures import build_razorpay_fixture_request
from .schemas import WebhookEventOut, SessionConfigIn, SessionConfigOut, RazorpayFixtureRequestOut


REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
TUNNEL_URL_FILE = "/shared/tunnel_url.txt"
MAX_INGEST_BODY_BYTES = int(os.getenv("MAX_INGEST_BODY_BYTES", os.getenv("MAX_WEBHOOK_BODY_BYTES", str(5 * 1024 * 1024))))
FORWARD_CONNECT_TIMEOUT_SECONDS = float(os.getenv("FORWARD_CONNECT_TIMEOUT_SECONDS", "2.0"))
FORWARD_READ_TIMEOUT_SECONDS = float(os.getenv("FORWARD_READ_TIMEOUT_SECONDS", "5.0"))
FORWARD_WRITE_TIMEOUT_SECONDS = float(os.getenv("FORWARD_WRITE_TIMEOUT_SECONDS", "5.0"))
FORWARD_POOL_TIMEOUT_SECONDS = float(os.getenv("FORWARD_POOL_TIMEOUT_SECONDS", "1.0"))
DEFAULT_CORS_ALLOW_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
BLOCKED_FORWARD_HOSTS = {
    "localhost",
    "host.docker.internal",
    "postgres",
    "redis",
    "metadata",
    "metadata.google.internal",
}
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

logger = logging.getLogger("hookrelay")


def is_truthy_env(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def parse_cleanup_cutoff(older_than: str) -> datetime:
    if not isinstance(older_than, str) or len(older_than) < 2:
        raise HTTPException(status_code=400, detail="older_than must use a value like 7d, 12h, or 30m")

    amount_text = older_than[:-1]
    unit = older_than[-1].lower()
    if not amount_text.isdigit():
        raise HTTPException(status_code=400, detail="older_than must use a value like 7d, 12h, or 30m")

    amount = int(amount_text)
    if amount < 1:
        raise HTTPException(status_code=400, detail="older_than must be at least 1 minute")

    if unit == "d":
        delta = timedelta(days=amount)
    elif unit == "h":
        delta = timedelta(hours=amount)
    elif unit == "m":
        delta = timedelta(minutes=amount)
    else:
        raise HTTPException(status_code=400, detail="older_than must end with d, h, or m")

    return datetime.utcnow() - delta
async def ensure_session_config_columns() -> None:
    if engine.dialect.name == "sqlite":
        return

    statements = [
        "ALTER TABLE session_configs ADD COLUMN IF NOT EXISTS provider VARCHAR(32) DEFAULT 'generic' NOT NULL",
        "ALTER TABLE session_configs ADD COLUMN IF NOT EXISTS razorpay_webhook_secret TEXT",
        "ALTER TABLE session_configs ADD COLUMN IF NOT EXISTS auth_token_hash TEXT",
    ]
    async with engine.begin() as connection:
        for statement in statements:
            try:
                await connection.execute(text(statement))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "ensure_column_failed",
                    extra={"statement": statement[:120], "error": str(exc)[:200]},
                )


async def ensure_webhook_event_columns() -> None:
    if engine.dialect.name == "sqlite":
        return

    statements = [
        "ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS replay_target_event_id INTEGER",
        "ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS forward_failure_kind VARCHAR(32)",
        "ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS forward_delivery_status VARCHAR(32)",
        "CREATE INDEX IF NOT EXISTS idx_webhook_events_session_id_id ON webhook_events (session_id, id)",
    ]
    async with engine.begin() as connection:
        for statement in statements:
            try:
                await connection.execute(text(statement))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "ensure_column_failed",
                    extra={"statement": statement[:120], "error": str(exc)[:200]},
                )
        if engine.dialect.name == "postgresql":
            statement = (
                "CREATE INDEX IF NOT EXISTS idx_webhook_events_razorpay_event_id "
                "ON webhook_events (session_id, ((headers ->> 'x-razorpay-event-id')), id) "
                "WHERE headers ? 'x-razorpay-event-id'"
            )
            try:
                await connection.execute(text(statement))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "ensure_column_failed",
                    extra={"statement": statement[:120], "error": str(exc)[:200]},
                )




def parse_cors_allow_origins() -> list[str]:
    configured = os.getenv("CORS_ALLOW_ORIGINS", DEFAULT_CORS_ALLOW_ORIGINS)
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def get_bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    return token or None


def require_session_token(config: models.SessionConfig | None, token: str | None) -> models.SessionConfig:
    if not config or not config.auth_token_hash:
        raise HTTPException(status_code=401, detail="Missing or invalid session bearer token")

    if not token or not hmac.compare_digest(hash_session_token(token), config.auth_token_hash):
        raise HTTPException(status_code=401, detail="Missing or invalid session bearer token")
    return config


async def require_session_control_auth(
    session_id: str,
    request: Request,
    db: AsyncSession,
) -> models.SessionConfig:
    result = await db.execute(
        select(models.SessionConfig).where(models.SessionConfig.session_id == session_id)
    )
    config = result.scalar_one_or_none()
    return require_session_token(config, get_bearer_token(request))


async def require_any_session_control_auth(request: Request, db: AsyncSession) -> None:
    token = get_bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid session bearer token")

    token_hash = hash_session_token(token)
    result = await db.execute(
        select(models.SessionConfig).where(models.SessionConfig.auth_token_hash == token_hash)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=401, detail="Missing or invalid session bearer token")


def get_websocket_token(websocket: WebSocket) -> str | None:
    authorization = websocket.headers.get("authorization")
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            return token

    token = websocket.query_params.get("token")
    if token:
        return token

    protocol = websocket.headers.get("sec-websocket-protocol")
    if protocol:
        parts = [part.strip() for part in protocol.split(",")]
        if len(parts) >= 2 and parts[0].lower() == "bearer" and parts[1]:
            return parts[1]
    return None


async def websocket_is_authorized(session_id: str, token: str | None, db: AsyncSession) -> bool:
    result = await db.execute(
        select(models.SessionConfig).where(models.SessionConfig.session_id == session_id)
    )
    config = result.scalar_one_or_none()
    if not config or not config.auth_token_hash or not token:
        return False
    return hmac.compare_digest(hash_session_token(token), config.auth_token_hash)


def address_is_blocked_for_forward(address) -> bool:
    return (
        address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def validate_forward_url(forward_url: Any | None) -> str | None:
    if forward_url is None:
        return None

    value = str(forward_url).strip()
    if not value:
        return None

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="forward_url must be an absolute http(s) URL")

    host = parsed.hostname.rstrip(".").lower()
    if is_truthy_env("ALLOW_LOOPBACK_FORWARD"):
        logger.warning(
            "forward_url.loopback_override_enabled",
            extra={"forward_host": host},
        )
        return value

    if host in BLOCKED_FORWARD_HOSTS:
        raise HTTPException(status_code=400, detail="forward_url host is not allowed")

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        try:
            resolved = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except socket.gaierror:
            raise HTTPException(status_code=400, detail="forward_url host could not be resolved")

        for result in resolved:
            resolved_host = result[4][0]
            try:
                resolved_address = ipaddress.ip_address(resolved_host)
            except ValueError:
                continue
            if address_is_blocked_for_forward(resolved_address):
                raise HTTPException(status_code=400, detail="forward_url host resolves to a disallowed address")
        return value

    if address_is_blocked_for_forward(address):
        raise HTTPException(status_code=400, detail="forward_url host is not allowed")
    return value


async def read_limited_body(request: Request) -> bytes:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_INGEST_BODY_BYTES:
                raise HTTPException(status_code=413, detail="Webhook body is too large")
        except ValueError:
            pass

    raw_body = await request.body()
    if len(raw_body) > MAX_INGEST_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Webhook body is too large")
    return raw_body


def enforce_razorpay_signature(
    config: models.SessionConfig | None,
    body_text: str | None,
    headers: dict,
) -> None:
    if normalize_provider(getattr(config, "provider", None)) != PROVIDER_RAZORPAY:
        return

    secret = getattr(config, "razorpay_webhook_secret", None)
    if not secret:
        return

    signature = get_header(headers, RAZORPAY_SIGNATURE_HEADER)
    signature_status, _ = verify_razorpay_signature(body_text, signature, secret)
    if signature_status != "valid":
        raise HTTPException(status_code=401, detail="Invalid Razorpay webhook signature")


def forward_url_warnings(forward_url: str | None) -> list[str]:
    if not forward_url:
        return []

    try:
        host = (urlparse(forward_url).hostname or "").rstrip(".").lower()
    except Exception:  # noqa: BLE001
        return []

    if host == "host.docker.internal":
        return [
            "host.docker.internal only resolves on Docker Desktop or Docker Engine 20.10+. "
            "On plain Linux without Docker Desktop, use the host's LAN IP instead."
        ]
    if host in {"localhost", "127.0.0.1", "::1"}:
        return [
            "Forwarding to loopback from inside the API container will not reach your host machine. "
            "Use host.docker.internal on Docker Desktop or the host's LAN IP."
        ]
    return []


def serialize_session_config(
    config: models.SessionConfig | None,
    session_id: str,
    auth_token: str | None = None,
    forward_url_warnings_override: list[str] | None = None,
) -> SessionConfigOut:
    warnings = forward_url_warnings_override
    if not config:
        return SessionConfigOut(session_id=session_id, forward_url_warnings=warnings or [])
    if warnings is None:
        warnings = forward_url_warnings(config.forward_url)
    return SessionConfigOut(
        session_id=config.session_id,
        forward_url=config.forward_url,
        provider=normalize_provider(config.provider),
        razorpay_webhook_secret_configured=bool(config.razorpay_webhook_secret),
        auth_token_configured=bool(config.auth_token_hash),
        auth_token=auth_token,
        forward_url_warnings=warnings,
    )


def read_tunnel_url_file() -> str | None:
    try:
        with open(TUNNEL_URL_FILE, "r") as file:
            url = file.read().strip()
        return url or None
    except FileNotFoundError:
        return None


# App lifespan
# Creates the Redis client once when the container starts.
# Closes it cleanly when the container stops.
# app.state.redis is then available anywhere in the app.

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    if is_truthy_env("HOOKRELAY_RUN_MIGRATIONS"):
        await asyncio.to_thread(run_alembic_upgrade)
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    yield
    await app.state.redis.aclose()


app = FastAPI(title="HookRelay", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_cors_allow_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

public_ingress_router = APIRouter()
local_control_router = APIRouter()


# Forward webhook helper

async def forward_webhook(
    forward_url: str,
    body: bytes | None,
    headers: dict | None = None,
    query_params: dict | None = None,
) -> tuple[int | None, str | None, str | None, str | None]:
    """
    POST the raw webhook body to the developer's real endpoint.
    Returns (status_code, response_body, error_message, failure_kind).
    """
    try:
        safe_forward_url = validate_forward_url(forward_url)
    except HTTPException as exc:
        return None, None, str(exc.detail)[:500], "invalid_url"

    forward_headers = {}
    if headers:
        for key, value in headers.items():
            if key.lower() in HOP_BY_HOP_HEADERS:
                continue
            forward_headers[key] = value

    try:
        timeout = httpx.Timeout(
            connect=FORWARD_CONNECT_TIMEOUT_SECONDS,
            read=FORWARD_READ_TIMEOUT_SECONDS,
            write=FORWARD_WRITE_TIMEOUT_SECONDS,
            pool=FORWARD_POOL_TIMEOUT_SECONDS,
        )
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            resp = await client.post(
                safe_forward_url,
                content=body or b"",
                headers=forward_headers,
                params=query_params or None,
            )
        return resp.status_code, resp.text[:2000], None, None
    except Exception as e:
        return None, None, str(e)[:500], classify_forward_exception(e)


def exception_chain_contains(exc: BaseException, expected_type: type[BaseException]) -> bool:
    current: BaseException | None = exc
    while current is not None:
        if isinstance(current, expected_type):
            return True
        current = current.__cause__ or current.__context__
    return False


def classify_forward_exception(exc: Exception) -> str:
    if isinstance(exc, httpx.InvalidURL):
        return "invalid_url"
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    if exception_chain_contains(exc, socket.gaierror):
        return "dns"
    if exception_chain_contains(exc, ssl.SSLError):
        return "tls"
    if isinstance(exc, httpx.ConnectError):
        return "connection"
    return "other"


def apply_forward_result(
    event: models.WebhookEvent,
    status: int | None,
    response: str | None,
    error: str | None,
    failure_kind: str | None,
) -> None:
    event.forward_status = status
    event.forward_response = response
    event.forward_error = error
    event.forward_failure_kind = failure_kind
    event.forward_delivery_status = delivery_status_from_forward_result(status, error)
    event.forwarded_at = datetime.utcnow()


async def publish_event_update(redis_client, session_id: str, event_id: int | None, event_data: dict) -> None:
    try:
        await redis_client.publish(f"webhook:{session_id}", json.dumps(event_data))
    except (redis.exceptions.RedisError, RuntimeError) as exc:
        logger.warning(
            "redis.publish_failed",
            extra={"session_id": session_id, "event_id": event_id, "error": str(exc)[:200]},
        )


async def forward_event_in_background(
    app: FastAPI,
    event_id: int,
    session_id: str,
    forward_url: str,
    body: bytes,
    headers: dict,
    query_params: dict,
) -> None:
    try:
        status, response, error, failure_kind = await forward_webhook(
            forward_url,
            body,
            headers=headers,
            query_params=query_params,
        )

        async with SessionLocal() as db:
            event_result = await db.execute(
                select(models.WebhookEvent).where(
                    models.WebhookEvent.id == event_id,
                    models.WebhookEvent.session_id == session_id,
                )
            )
            event = event_result.scalar_one_or_none()
            config_result = await db.execute(
                select(models.SessionConfig).where(models.SessionConfig.session_id == session_id)
            )
            config = config_result.scalar_one_or_none()
            if not event:
                logger.warning("forward.background_event_missing", extra={"session_id": session_id, "event_id": event_id})
                return

            apply_forward_result(event, status, response, error, failure_kind)
            await db.commit()
            await db.refresh(event)
            event_data = await serialize_event(event, db, config)

        logger.info(
            "webhook.forwarded",
            extra={
                "session_id": session_id,
                "event_id": event_id,
                "forward_status": status,
                "forward_failure_kind": failure_kind,
            },
        )
        await publish_event_update(app.state.redis, session_id, event_id, event_data)
    except Exception:
        logger.exception("forward.background_failed", extra={"session_id": session_id, "event_id": event_id})


def run_alembic_upgrade() -> None:
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parents[1]
    alembic_config = Config(str(backend_dir / "alembic.ini"))
    alembic_config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(alembic_config, "head")


# POST /hooks/{session_id}
# Receives a webhook, saves to PostgreSQL, publishes to Redis,
# and optionally forwards to the developer's real endpoint.

@public_ingress_router.post("/hooks/{session_id}", status_code=200)
async def receive_webhook(
    session_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    raw_body = await read_limited_body(request)
    body_text = raw_body.decode("utf-8") if raw_body else None
    request_headers = dict(request.headers)
    request_query_params = dict(request.query_params)
    config_result = await db.execute(
        select(models.SessionConfig).where(models.SessionConfig.session_id == session_id)
    )
    config = config_result.scalar_one_or_none()
    enforce_razorpay_signature(config, body_text, request_headers)

    event = models.WebhookEvent(
        session_id=session_id,
        method=request.method,
        headers=request_headers,
        body=body_text,
        query_params=request_query_params,
        forward_delivery_status=FORWARD_STATUS_PENDING if config and config.forward_url else FORWARD_STATUS_NOT_FORWARDED,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    logger.info("webhook.received", extra={"session_id": session_id, "event_id": event.id, "method": request.method})

    config_result = await db.execute(
        select(models.SessionConfig).where(models.SessionConfig.session_id == session_id)
    )
    config = config_result.scalar_one_or_none()

    # Publish the saved event to Redis channel "webhook:<session_id>"
    event_data = await serialize_event(event, db, config)
    await publish_event_update(request.app.state.redis, session_id, event.id, event_data)

    if config and config.forward_url:
        if is_truthy_env("FORWARD_FIRE_AND_FORGET"):
            asyncio.create_task(
                forward_event_in_background(
                    request.app,
                    event.id,
                    session_id,
                    config.forward_url,
                    raw_body,
                    request_headers,
                    request_query_params,
                )
            )
            return {"status": "received", "id": event.id}

        status, response, error, failure_kind = await forward_webhook(
            config.forward_url,
            raw_body,
            headers=request_headers,
            query_params=request_query_params,
        )
        apply_forward_result(event, status, response, error, failure_kind)
        await db.commit()
        logger.info(
            "webhook.forwarded",
            extra={
                "session_id": session_id,
                "event_id": event.id,
                "forward_status": status,
                "forward_failure_kind": failure_kind,
            },
        )
        await db.refresh(event)

        # Re-publish with forwarding data so the dashboard updates
        event_data = await serialize_event(event, db, config)
        await publish_event_update(request.app.state.redis, session_id, event.id, event_data)

    return {"status": "received", "id": event.id}


# GET /hooks/{session_id}
# Returns full history from PostgreSQL when the dashboard first loads.

@local_control_router.get("/hooks/{session_id}", response_model=List[WebhookEventOut])
async def get_webhooks(
    session_id: str,
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    before_id: Optional[int] = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
):
    config = await require_session_control_auth(session_id, request, db)
    events_query = select(models.WebhookEvent).where(models.WebhookEvent.session_id == session_id)
    if before_id is not None:
        events_query = events_query.where(models.WebhookEvent.id < before_id)
    result = await db.execute(events_query.order_by(models.WebhookEvent.id.desc()).limit(limit))
    events = result.scalars().all()
    return [await serialize_event(event, db, config) for event in events]


# DELETE /hooks/{session_id}

@local_control_router.delete("/hooks/{session_id}", status_code=200)
async def clear_webhooks(session_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    await require_session_control_auth(session_id, request, db)
    result = await db.execute(
        delete(models.WebhookEvent).where(models.WebhookEvent.session_id == session_id)
    )
    await db.commit()
    deleted = result.rowcount or 0
    return {"status": "cleared", "deleted_count": deleted}


# DELETE /sessions/{session_id}

@local_control_router.delete("/sessions/{session_id}", status_code=200)
async def delete_session(session_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    await require_session_control_auth(session_id, request, db)
    # Delete all events
    await db.execute(delete(models.WebhookEvent).where(models.WebhookEvent.session_id == session_id))
    # Delete config
    await db.execute(delete(models.SessionConfig).where(models.SessionConfig.session_id == session_id))
    await db.commit()
    return {"status": "deleted"}


# POST /hooks/{session_id}/{event_id}/replay
# Re-forwards a stored event to the session's configured forwarding URL.
# Creates a new event record so it shows up in the dashboard timeline.

@local_control_router.post("/hooks/{session_id}/{event_id}/replay", status_code=200)
async def replay_event(
    session_id: str,
    event_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    # Load the original event
    config = await require_session_control_auth(session_id, request, db)
    result = await db.execute(
        select(models.WebhookEvent).where(
            models.WebhookEvent.id == event_id,
            models.WebhookEvent.session_id == session_id,
        )
    )
    original = result.scalar_one_or_none()
    if not original:
        raise HTTPException(status_code=404, detail="Event not found")

    # Load session config for forward URL
    if not config or not config.forward_url:
        raise HTTPException(status_code=400, detail="No forwarding URL configured for this session")

    # Forward the original payload
    raw_body, replay_headers, replay_query_params = build_replay_forward_payload(original)
    status, response, error, failure_kind = await forward_webhook(
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
        forward_failure_kind=failure_kind,
        forward_delivery_status=delivery_status_from_forward_result(status, error),
        forwarded_at=datetime.utcnow(),
        replay_target_event_id=original.id,
    )
    db.add(replay_event)
    await db.commit()
    await db.refresh(replay_event)

    # Publish to dashboard
    event_data = await serialize_event(replay_event, db, config)
    await publish_event_update(request.app.state.redis, session_id, replay_event.id, event_data)

    if error or status is None or not (200 <= status < 300):
        detail = f"Replay forwarding failed for replay event {replay_event.id}"
        if status is not None:
            detail += f" with status {status}"
        if error:
            detail += f": {error}"
        raise HTTPException(status_code=502, detail=detail)

    return {"status": "replayed", "id": replay_event.id, "forward_status": status}


# WebSocket /ws/{session_id}
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
async def websocket_endpoint(websocket: WebSocket, session_id: str, db: AsyncSession = Depends(get_db)):
    if not await websocket_is_authorized(session_id, get_websocket_token(websocket), db):
        await websocket.close(code=1008)
        return

    protocol = websocket.headers.get("sec-websocket-protocol")
    accept_subprotocol = "bearer" if protocol and protocol.split(",")[0].strip().lower() == "bearer" else None
    await websocket.accept(subprotocol=accept_subprotocol)

    # Each WebSocket connection gets its own Redis pubsub object
    pubsub = websocket.app.state.redis.pubsub()
    channel = f"webhook:{session_id}"
    await pubsub.subscribe(channel)
    stop_event = asyncio.Event()
    HEARTBEAT_INTERVAL = 25.0

    async def forward_to_browser():
        """Read from Redis, send to browser."""
        while not stop_event.is_set():
            try:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.05)
            except (redis.exceptions.RedisError, RuntimeError) as exc:
                logger.warning(
                    "websocket.pubsub_failed",
                    extra={"session_id": session_id, "error": str(exc)[:200]},
                )
                break
            if message is None:
                await asyncio.sleep(0)
                continue
            if message.get("type") != "message":
                continue
            try:
                await websocket.send_text(message["data"])
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "websocket.send_failed",
                    extra={"session_id": session_id, "error": str(exc)[:200]},
                )
                break

    async def heartbeat_loop():
        """Keep proxies and browsers from treating an idle stream as dead."""
        while not stop_event.is_set():
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            if stop_event.is_set():
                return
            try:
                await websocket.send_text(json.dumps({"type": "ping"}))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "websocket.heartbeat_failed",
                    extra={"session_id": session_id, "error": str(exc)[:200]},
                )
                return

    async def wait_for_disconnect():
        """Block until the browser closes the connection."""
        try:
            while not stop_event.is_set():
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "websocket.receive_failed",
                extra={"session_id": session_id, "error": str(exc)[:200]},
            )

    forward_task    = asyncio.create_task(forward_to_browser())
    heartbeat_task  = asyncio.create_task(heartbeat_loop())
    disconnect_task = asyncio.create_task(wait_for_disconnect())

    # Wait for whichever finishes first
    tasks = {forward_task, heartbeat_task, disconnect_task}

    try:
        done, pending = await asyncio.wait(
            tasks,
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in done:
            task.result()

        for task in pending:
            task.cancel()
    finally:
        stop_event.set()
        for task in tasks:
            if not task.done():
                task.cancel()

        await asyncio.gather(*tasks, return_exceptions=True)

        try:
            await asyncio.wait_for(pubsub.unsubscribe(channel), timeout=2.0)
        except (asyncio.TimeoutError, redis.exceptions.RedisError, RuntimeError) as exc:
            logger.warning(
                "websocket.unsubscribe_failed",
                extra={"session_id": session_id, "error": str(exc)[:200]},
            )

        try:
            await asyncio.wait_for(pubsub.aclose(), timeout=2.0)
        except (asyncio.TimeoutError, redis.exceptions.RedisError, RuntimeError) as exc:
            logger.warning(
                "websocket.aclose_failed",
                extra={"session_id": session_id, "error": str(exc)[:200]},
            )


# POST /sessions/{session_id}/init

@local_control_router.post("/sessions/{session_id}/init", response_model=SessionConfigOut)
async def init_session(session_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.SessionConfig).where(models.SessionConfig.session_id == session_id)
    )
    config = result.scalar_one_or_none()
    if config and config.auth_token_hash:
        require_session_token(config, get_bearer_token(request))

    auth_token = generate_session_token()
    if config:
        config.auth_token_hash = hash_session_token(auth_token)
        config.updated_at = datetime.utcnow()
    else:
        config = models.SessionConfig(
            session_id=session_id,
            auth_token_hash=hash_session_token(auth_token),
        )
        db.add(config)

    await db.commit()
    await db.refresh(config)
    return serialize_session_config(config, session_id, auth_token=auth_token)


# GET /sessions
# Returns all distinct session IDs ordered by most recent activity.
# Fetches from both WebhookEvents and SessionConfigs to ensure empty sessions with saved configs are not lost.

@local_control_router.get("/sessions")
async def get_sessions(request: Request, db: AsyncSession = Depends(get_db)):
    await require_any_session_control_auth(request, db)
    events_result = await db.execute(
        select(
            models.WebhookEvent.session_id,
            func.max(models.WebhookEvent.received_at).label("last_active"),
        ).group_by(models.WebhookEvent.session_id)
    )
    events = events_result.all()

    configs_result = await db.execute(
        select(models.SessionConfig.session_id, models.SessionConfig.updated_at.label("last_active"))
    )
    configs = configs_result.all()

    session_dict = {}
    for r in events:
        session_dict[r.session_id] = r.last_active
        
    for r in configs:
        t = r.last_active or datetime.min
        if r.session_id not in session_dict or (session_dict[r.session_id] is None) or t > session_dict[r.session_id]:
            session_dict[r.session_id] = t
            
    sorted_sessions = sorted(session_dict.keys(), key=lambda k: session_dict[k] or datetime.min, reverse=True)
    return sorted_sessions


# PUT /sessions/{session_id}/config
# Save or update the forwarding URL for a session.

@local_control_router.put("/sessions/{session_id}/config", response_model=SessionConfigOut)
async def update_session_config(
    session_id: str,
    config_in: SessionConfigIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    config = await require_session_control_auth(session_id, request, db)
    fields = config_in.model_fields_set
    auth_token = None

    if "forward_url" in fields:
        config.forward_url = validate_forward_url(config_in.forward_url)
    if "provider" in fields and config_in.provider is not None:
        config.provider = normalize_provider(config_in.provider)
    if "razorpay_webhook_secret" in fields:
        secret = (config_in.razorpay_webhook_secret or "").strip()
        config.razorpay_webhook_secret = secret or None
    if config_in.rotate_auth_token:
        auth_token = generate_session_token()
        config.auth_token_hash = hash_session_token(auth_token)
    config.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(config)
    return serialize_session_config(config, session_id, auth_token=auth_token)


# GET /sessions/{session_id}/config
# Get the forwarding URL for a session.

@local_control_router.get("/sessions/{session_id}/config", response_model=SessionConfigOut)
async def get_session_config(session_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    config = await require_session_control_auth(session_id, request, db)
    return serialize_session_config(config, session_id)


@local_control_router.post(
    "/sessions/{session_id}/razorpay-fixtures/{fixture_key}",
    response_model=RazorpayFixtureRequestOut,
)
async def create_razorpay_fixture_request(
    session_id: str,
    fixture_key: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    config = await require_session_control_auth(session_id, request, db)
    secret = None
    if config and normalize_provider(config.provider) == PROVIDER_RAZORPAY:
        secret = config.razorpay_webhook_secret

    try:
        return build_razorpay_fixture_request(fixture_key, secret)
    except ValueError:
        raise HTTPException(status_code=404, detail="Unknown Razorpay fixture")


# Admin cleanup and tunnel URL routes
# Returns the current Cloudflare tunnel URL if available.
# The tunnel container writes its URL to /shared/tunnel-url.txt.

@local_control_router.post("/admin/cleanup", status_code=200)
async def cleanup_events(request: Request, payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id is required for cleanup")

    session_id = str(session_id)
    await require_session_control_auth(session_id, request, db)
    cutoff = parse_cleanup_cutoff(payload.get("older_than"))
    result = await db.execute(
        delete(models.WebhookEvent).where(
            models.WebhookEvent.session_id == session_id,
            models.WebhookEvent.received_at < cutoff,
        )
    )
    await db.commit()
    deleted = result.rowcount or 0
    logger.info("cleanup.events", extra={"session_id": session_id, "deleted_events": deleted})
    return {"deleted_events": deleted}

@local_control_router.get("/tunnel-url")
async def get_tunnel_url(request: Request, db: AsyncSession = Depends(get_db)):
    await require_any_session_control_auth(request, db)
    return {"url": read_tunnel_url_file()}


# GET /health

@local_control_router.get("/health")
async def health(request: Request, db: AsyncSession = Depends(get_db)):
    postgres_status = "ok"
    redis_status = "ok"

    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        postgres_status = "error"

    try:
        redis_ping = request.app.state.redis.ping()
        if hasattr(redis_ping, "__await__"):
            await redis_ping
    except Exception:
        redis_status = "error"

    status = "ok" if postgres_status == "ok" and redis_status == "ok" else "degraded"
    return {
        "status": status,
        "postgres": postgres_status,
        "redis": redis_status,
        "tunnel_url_present": bool(read_tunnel_url_file()),
    }


app.include_router(public_ingress_router)
app.include_router(local_control_router)
