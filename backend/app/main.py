import asyncio
import json
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from ipaddress import ip_address, ip_network
from urllib.parse import urlparse

import httpx
import redis.asyncio as aioredis
from fastapi import FastAPI, Request, Depends, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from typing import List

from . import models
from .database import engine, get_db, Base
from .schemas import WebhookEventOut, SessionConfigIn, SessionConfigOut

# ─── Structured Logging ─────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    stream=os.sys.stdout
)
logger = logging.getLogger("hookrelay")

# ─── Rate Limiting ───────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

# ─── App Configuration ──────────────────────────────────────────────────────────
app = FastAPI(
    title="HookRelay API",
    description="Webhook proxy for local development. Catch webhooks, inspect them, forward to your local app, and replay on demand.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=None  # Will be set below
)

app.state.limiter = limiter

# ─── Database Migrations Check ─────────────────────────────────────────────────
# Run migrations on startup (Alembic should handle this in production)
def run_migrations():
    """Run database migrations. Called on startup."""
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created/verified")
    except Exception as e:
        logger.error(f"Database migration error: {e}")
        raise

run_migrations()

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

# ─── Configuration ────────────────────────────────────────────────────────────────
MAX_BODY_SIZE = int(os.getenv("MAX_BODY_SIZE", 1024 * 1024))  # 1MB default


# ─── Request ID Middleware ─────────────────────────────────────────────────────
@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """Add X-Request-ID to each request for tracing."""
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id

    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id

    return response


# ─── Security Validation Functions ─────────────────────────────────────────────

def validate_session_id(session_id: str) -> bool:
    """Validate session_id format - alphanumeric, dash, underscore only, max 100 chars."""
    if not session_id or len(session_id) > 100:
        return False
    return bool(re.match(r'^[a-zA-Z0-9_-]+$', session_id))


def is_safe_forward_url(url: str) -> tuple[bool, str]:
    """
    Validate URL is safe for forwarding (prevents SSRF attacks).
    Returns (is_safe, error_message).
    """
    if not url:
        return False, "Forward URL is required"

    try:
        parsed = urlparse(url)
    except Exception as e:
        return False, f"Invalid URL: {e}"

    if parsed.scheme not in ('http', 'https'):
        return False, "Only HTTP and HTTPS schemes are allowed"

    if not parsed.hostname:
        return False, "URL must have a hostname"

    # Block localhost variants
    if parsed.hostname in ('localhost', 'localhost.localdomain'):
        return False, "Localhost URLs are not allowed"

    try:
        host_ip = ip_address(parsed.hostname)
        # Block private/internal ranges
        private_networks = [
            ip_network('127.0.0.0/8'),
            ip_network('10.0.0.0/8'),
            ip_network('172.16.0.0/12'),
            ip_network('192.168.0.0/16'),
            ip_network('169.254.0.0/16'),  # Cloud metadata
            ip_network('0.0.0.0/8'),
            ip_network('100.64.0.0/10'),  # Carrier-grade NAT
            ip_network('224.0.0.0/4'),  # Multicast
            ip_network('240.0.0.0/4'),  # Reserved
        ]
        for net in private_networks:
            if host_ip in net:
                return False, f"Internal/private IP addresses are not allowed ({parsed.hostname})"
    except ValueError:
        # Not an IP address - allow but could add domain blacklist here
        pass

    return True, None


# ─── App Lifespan ─────────────────────────────────────────────────────────────
# Creates the Redis client once when the container starts.
# Closes it cleanly when the container stops.
# app.state.redis is then available anywhere in the app.

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    logger.info(f"Redis connected to {REDIS_URL}")
    yield
    await app.state.redis.aclose()
    logger.info("Redis connection closed")

app.router.lifespan_context = lifespan


# ─── CORS Middleware ───────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Helper: Forward webhook to developer's app ──────────────────────────────

async def forward_webhook(
    forward_url: str,
    body: bytes | None,
    content_type: str,
    request_id: str = None,
) -> tuple[int | None, str | None, str | None]:
    """
    POST the raw webhook body to the developer's real endpoint.
    Returns (status_code, response_body, error_message).
    """
    # Validate URL before making request (SSRF protection)
    is_safe, error = is_safe_forward_url(forward_url)
    if not is_safe:
        logger.warning(f"[{request_id}] URL validation failed: {error}")
        return None, None, f"URL validation failed: {error}"

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.post(
                forward_url,
                content=body or b"",
                headers={"Content-Type": content_type},
            )
        logger.info(f"[{request_id}] Forwarded to {forward_url}, status={resp.status_code}")
        return resp.status_code, resp.text[:2000], None
    except Exception as e:
        logger.error(f"[{request_id}] Forward error: {e}")
        return None, None, str(e)[:500]


# ─── POST /hooks/{session_id} ─────────────────────────────────────────────────
# Receives a webhook, saves to PostgreSQL, publishes to Redis,
# and optionally forwards to the developer's real endpoint.

@app.post("/hooks/{session_id}", status_code=200)
@limiter.limit("100/minute")
async def receive_webhook(
    request: Request,
    session_id: str,
    db: Session = Depends(get_db),
):
    """
    Receive a webhook for a session.

    - **session_id**: Session identifier (alphanumeric, dash, underscore, max 100 chars)
    - **request**: Raw HTTP request with headers, body, query params
    - Returns: Confirmation with event ID
    """
    request_id = request.state.request_id

    if not validate_session_id(session_id):
        logger.warning(f"[{request_id}] Invalid session_id: {session_id}")
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    # Check Content-Length for body size limit
    content_length = request.headers.get("Content-Length")
    if content_length and int(content_length) > MAX_BODY_SIZE:
        logger.warning(f"[{request_id}] Body too large: {content_length} bytes")
        raise HTTPException(status_code=413, detail=f"Payload too large. Max size: {MAX_BODY_SIZE} bytes")

    logger.info(f"[{request_id}] Webhook received for session: {session_id}")

    raw_body = await request.body()
    body_text = raw_body.decode("utf-8") if raw_body else None

    event = models.WebhookEvent(
        session_id=session_id,
        method=request.method,
        headers=dict(request.headers),
        body=body_text,
        query_params=dict(request.query_params),
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    logger.info(f"[{request_id}] Event saved: id={event.id}")

    # Publish the saved event to Redis channel "webhook:<session_id>"
    event_data = jsonable_encoder(WebhookEventOut.model_validate(event))
    try:
        await request.app.state.redis.publish(
            f"webhook:{session_id}",
            json.dumps(event_data),
        )
    except Exception as e:
        logger.error(f"[{request_id}] Redis publish failed: {e}")

    # Check if this session has a forwarding URL configured
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    if config and config.forward_url:
        content_type = request.headers.get("content-type", "application/json")
        status, response, error = await forward_webhook(
            config.forward_url, raw_body, content_type, request_id
        )
        event.forward_status = status
        event.forward_response = response
        event.forward_error = error
        event.forwarded_at = datetime.utcnow()
        db.commit()
        db.refresh(event)

        # Re-publish with forwarding data so the dashboard updates
        event_data = jsonable_encoder(WebhookEventOut.model_validate(event))
        try:
            await request.app.state.redis.publish(
                f"webhook:{session_id}",
                json.dumps(event_data),
            )
        except Exception as e:
            logger.error(f"[{request_id}] Redis publish failed (forward update): {e}")

    return {"status": "received", "id": event.id, "request_id": request_id}


# ─── GET /hooks/{session_id} ──────────────────────────────────────────────────
# Returns full history from PostgreSQL — used when the dashboard first loads.

@app.get("/hooks/{session_id}", response_model=List[WebhookEventOut])
def get_webhooks(session_id: str, db: Session = Depends(get_db)):
    """
    Get all webhook events for a session.

    - **session_id**: Session identifier
    - Returns: List of webhook events ordered by received_at descending
    """
    if not validate_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    return (
        db.query(models.WebhookEvent)
        .filter(models.WebhookEvent.session_id == session_id)
        .order_by(models.WebhookEvent.received_at.desc())
        .all()
    )


# ─── DELETE /hooks/{session_id} ───────────────────────────────────────────────

@app.delete("/hooks/{session_id}", status_code=200)
@limiter.limit("50/minute")
def clear_webhooks(session_id: str, db: Session = Depends(get_db)):
    """
    Clear all webhook events for a session.

    - **session_id**: Session identifier
    - Returns: Status with count of deleted events
    """
    if not validate_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    deleted = (
        db.query(models.WebhookEvent)
        .filter(models.WebhookEvent.session_id == session_id)
        .delete()
    )
    db.commit()
    logger.info(f"Cleared {deleted} events for session: {session_id}")
    return {"status": "cleared", "deleted_count": deleted}


# ─── DELETE /sessions/{session_id} ────────────────────────────────────────────

@app.delete("/sessions/{session_id}", status_code=200)
@limiter.limit("30/minute")
def delete_session(session_id: str, db: Session = Depends(get_db)):
    """
    Delete a session and all its events.

    - **session_id**: Session identifier
    - Returns: Status confirmation
    """
    if not validate_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    # Delete all events
    db.query(models.WebhookEvent).filter(models.WebhookEvent.session_id == session_id).delete()
    # Delete config
    db.query(models.SessionConfig).filter(models.SessionConfig.session_id == session_id).delete()
    db.commit()
    logger.info(f"Deleted session: {session_id}")
    return {"status": "deleted"}


# ─── POST /hooks/{session_id}/{event_id}/replay ──────────────────────────────
# Re-forwards a stored event to the session's configured forwarding URL.
# Creates a new event record so it shows up in the dashboard timeline.

@app.post("/hooks/{session_id}/{event_id}/replay", status_code=200)
@limiter.limit("30/minute")
async def replay_event(
    session_id: str,
    event_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Replay a stored webhook event.

    - **session_id**: Session identifier
    - **event_id**: Event ID to replay
    - Returns: Status with new event ID and forward status
    """
    request_id = request.state.request_id

    if not validate_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")

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
    raw_body = original.body.encode("utf-8") if original.body else b""
    content_type = "application/json"
    if original.headers and isinstance(original.headers, dict):
        content_type = original.headers.get("content-type", "application/json")

    status, response, error = await forward_webhook(
        config.forward_url, raw_body, content_type, request_id
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
    event_data = jsonable_encoder(WebhookEventOut.model_validate(replay_event))
    try:
        await request.app.state.redis.publish(
            f"webhook:{session_id}",
            json.dumps(event_data),
        )
    except Exception as e:
        logger.error(f"[{request_id}] Redis publish failed (replay): {e}")

    logger.info(f"[{request_id}] Replayed event {event_id} as {replay_event.id}")
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

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for real-time webhook updates.

    - **session_id**: Session identifier to subscribe to
    - Browser receives live webhook events as they arrive
    """
    # Validate session_id - close connection if invalid
    if not validate_session_id(session_id):
        await websocket.close(code=4000, reason="Invalid session_id format")
        return

    await websocket.accept()
    logger.info(f"WebSocket connected for session: {session_id}")

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
    logger.info(f"WebSocket disconnected for session: {session_id}")


# ─── GET /sessions ──────────────────────────────────────────────────────────
# Returns all distinct session IDs ordered by most recent activity.
# Fetches from both WebhookEvents and SessionConfigs to ensure empty sessions with saved configs are not lost.

@app.get("/sessions")
def get_sessions(db: Session = Depends(get_db)):
    """
    Get all session IDs ordered by most recent activity.

    - Returns: List of session IDs
    """
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

@app.put("/sessions/{session_id}/config", response_model=SessionConfigOut)
def update_session_config(
    session_id: str,
    config_in: SessionConfigIn,
    db: Session = Depends(get_db),
):
    """
    Save or update forwarding URL for a session.

    - **session_id**: Session identifier
    - **forward_url**: URL to forward webhooks to (validated for SSRF)
    - Returns: Updated session config
    """
    if not validate_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    # Validate forward_url if provided (SSRF check)
    if config_in.forward_url:
        is_safe, error = is_safe_forward_url(config_in.forward_url)
        if not is_safe:
            raise HTTPException(status_code=400, detail=f"Invalid forward_url: {error}")

    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    if config:
        config.forward_url = config_in.forward_url
        config.updated_at = datetime.utcnow()
    else:
        config = models.SessionConfig(
            session_id=session_id,
            forward_url=config_in.forward_url,
        )
        db.add(config)
    db.commit()
    db.refresh(config)
    return config


# ─── GET /sessions/{session_id}/config ────────────────────────────────────────
# Get the forwarding URL for a session.

@app.get("/sessions/{session_id}/config", response_model=SessionConfigOut)
def get_session_config(session_id: str, db: Session = Depends(get_db)):
    """
    Get forwarding URL for a session.

    - **session_id**: Session identifier
    - Returns: Session config with forward_url
    """
    if not validate_session_id(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id format")

    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    if not config:
        return SessionConfigOut(session_id=session_id, forward_url=None)
    return config


# ─── GET /tunnel-url ──────────────────────────────────────────────────────────
# Returns the current Cloudflare tunnel URL if available.
# The tunnel container writes its URL to /shared/tunnel-url.txt.

@app.get("/tunnel-url")
def get_tunnel_url():
    """
    Get the current Cloudflare tunnel URL.

    - Returns: Object with url (null if not available)
    """
    try:
        with open("/shared/tunnel_url.txt", "r") as f:
            url = f.read().strip()
        return {"url": url or None}
    except FileNotFoundError:
        return {"url": None}


# ─── GET /health ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health(db: Session = Depends(get_db)):
    """
    Health check endpoint.

    - Returns: Status of API, database, and Redis connections
    """
    checks = {
        "api": "healthy",
        "database": "unhealthy",
        "redis": "unhealthy"
    }

    # Check PostgreSQL
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "healthy"
    except Exception as e:
        logger.error(f"Database health check failed: {e}")

    # Check Redis (async)
    try:
        await app.state.redis.ping()
        checks["redis"] = "healthy"
    except Exception as e:
        logger.error(f"Redis health check failed: {e}")

    # Determine overall status
    is_healthy = checks["database"] == "healthy" and checks["redis"] == "healthy"
    status_code = 200 if is_healthy else 503

    return JSONResponse(
        content=checks,
        status_code=status_code
    )