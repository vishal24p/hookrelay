import asyncio
import json
import os
from contextlib import asynccontextmanager
from contextlib import suppress
from datetime import datetime
from typing import Any, List

import httpx
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .database import engine, get_db, Base
from .schemas import GitHubWebhookStatusOut, WebhookEventOut, SessionConfigIn, SessionConfigOut

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
GITHUB_API_BASE = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"


def parse_bool_env(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_csv_env(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


def read_tunnel_url_file() -> str | None:
    try:
        with open(TUNNEL_URL_FILE, "r") as file:
            url = file.read().strip()
        return url or None
    except FileNotFoundError:
        return None


def load_github_webhook_config() -> dict[str, Any]:
    token = os.getenv("GITHUB_WEBHOOK_TOKEN")
    owner = os.getenv("GITHUB_WEBHOOK_OWNER")
    repo = os.getenv("GITHUB_WEBHOOK_REPO")
    secret = os.getenv("GITHUB_WEBHOOK_SECRET")
    session_id = os.getenv("GITHUB_WEBHOOK_SESSION_ID", "github").strip() or "github"
    events = parse_csv_env(os.getenv("GITHUB_WEBHOOK_EVENTS"), ["push", "ping"])
    autoconfig = parse_bool_env(os.getenv("GITHUB_WEBHOOK_AUTOCONFIG"), True)
    try:
        poll_interval = max(5, int(os.getenv("GITHUB_WEBHOOK_POLL_INTERVAL_SECONDS", "10")))
    except ValueError:
        poll_interval = 10

    configured = all([token, owner, repo, secret])
    enabled = configured and autoconfig

    return {
        "token": token,
        "owner": owner,
        "repo": repo,
        "secret": secret,
        "session_id": session_id,
        "events": events,
        "autoconfig": autoconfig,
        "configured": configured,
        "enabled": enabled,
        "poll_interval": poll_interval,
    }


def build_github_status_state(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "configured": config["configured"],
        "enabled": config["enabled"],
        "owner": config["owner"],
        "repo": config["repo"],
        "session_id": config["session_id"],
        "events": config["events"],
        "current_tunnel_url": None,
        "desired_webhook_url": None,
        "managed_hook_id": None,
        "last_sync_status": "idle" if config["enabled"] else "disabled",
        "last_sync_error": None,
        "last_synced_at": None,
        "last_successful_url": None,
    }


def github_request_headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
    }


def github_hook_matches_path(hook: dict[str, Any], session_id: str) -> bool:
    config = hook.get("config") or {}
    url = config.get("url")
    if not isinstance(url, str):
        return False
    return url.rstrip("/").endswith(f"/api/hooks/{session_id}")


def github_hook_matches_events(hook: dict[str, Any], expected_events: list[str]) -> bool:
    hook_events = hook.get("events")
    if not isinstance(hook_events, list):
        return False
    return set(hook_events) == set(expected_events)


def select_managed_hook(candidates: list[dict[str, Any]], expected_events: list[str]) -> dict[str, Any] | None:
    exact_matches = [hook for hook in candidates if github_hook_matches_events(hook, expected_events)]
    pool = exact_matches or candidates
    if not pool:
        return None

    return max(pool, key=lambda hook: hook.get("updated_at") or hook.get("created_at") or "")


async def list_github_repo_webhooks(config: dict[str, Any]) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"{GITHUB_API_BASE}/repos/{config['owner']}/{config['repo']}/hooks",
            headers=github_request_headers(config["token"]),
        )
        response.raise_for_status()
        return response.json()


async def create_github_repo_webhook(config: dict[str, Any], webhook_url: str) -> dict[str, Any]:
    payload = {
        "name": "web",
        "active": True,
        "events": config["events"],
        "config": {
            "url": webhook_url,
            "content_type": "json",
            "secret": config["secret"],
            "insecure_ssl": "0",
        },
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{GITHUB_API_BASE}/repos/{config['owner']}/{config['repo']}/hooks",
            headers=github_request_headers(config["token"]),
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def update_github_repo_webhook(config: dict[str, Any], hook_id: int, webhook_url: str) -> dict[str, Any]:
    payload = {
        "active": True,
        "events": config["events"],
        "config": {
            "url": webhook_url,
            "content_type": "json",
            "secret": config["secret"],
            "insecure_ssl": "0",
        },
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.patch(
            f"{GITHUB_API_BASE}/repos/{config['owner']}/{config['repo']}/hooks/{hook_id}",
            headers=github_request_headers(config["token"]),
            json=payload,
        )
        response.raise_for_status()
        return response.json()


async def reconcile_github_webhook(app: FastAPI, force: bool = False) -> dict[str, Any]:
    config = app.state.github_webhook_config
    status = app.state.github_webhook_status

    tunnel_url = read_tunnel_url_file()
    desired_url = (
        f"{tunnel_url.rstrip('/')}/api/hooks/{config['session_id']}"
        if tunnel_url
        else None
    )

    status["current_tunnel_url"] = tunnel_url
    status["desired_webhook_url"] = desired_url

    if not config["configured"]:
        status["last_sync_status"] = "disabled"
        status["last_sync_error"] = "GitHub webhook automation is not configured."
        return status

    if not config["enabled"]:
        status["last_sync_status"] = "disabled"
        status["last_sync_error"] = "GitHub webhook automation is disabled."
        return status

    if not desired_url:
        status["last_sync_status"] = "idle"
        status["last_sync_error"] = None
        return status

    if not force and status.get("last_successful_url") == desired_url:
        status["last_sync_status"] = "success"
        status["last_sync_error"] = None
        return status

    async with app.state.github_webhook_lock:
        if not force and status.get("last_successful_url") == desired_url:
            status["last_sync_status"] = "success"
            status["last_sync_error"] = None
            return status

        try:
            hooks = await list_github_repo_webhooks(config)
            candidates = [
                hook for hook in hooks
                if github_hook_matches_path(hook, config["session_id"])
            ]
            managed_hook = select_managed_hook(candidates, config["events"])

            if managed_hook and len(candidates) > 1:
                print(
                    f"[github-webhook-sync] multiple candidate hooks found for "
                    f"{config['owner']}/{config['repo']} session {config['session_id']}; "
                    f"updating hook {managed_hook.get('id')}"
                )

            if managed_hook:
                hook_payload = await update_github_repo_webhook(
                    config,
                    managed_hook["id"],
                    desired_url,
                )
            else:
                hook_payload = await create_github_repo_webhook(config, desired_url)

            status["managed_hook_id"] = hook_payload.get("id")
            status["last_sync_status"] = "success"
            status["last_sync_error"] = None
            status["last_synced_at"] = datetime.utcnow()
            status["last_successful_url"] = desired_url
            return status
        except httpx.HTTPStatusError as error:
            message = f"GitHub API {error.response.status_code}: {error.response.text[:500]}"
            status["last_sync_status"] = "error"
            status["last_sync_error"] = message
            status["last_synced_at"] = datetime.utcnow()
            return status
        except Exception as error:
            status["last_sync_status"] = "error"
            status["last_sync_error"] = str(error)[:500]
            status["last_synced_at"] = datetime.utcnow()
            return status


async def github_webhook_reconciler(app: FastAPI):
    while True:
        await reconcile_github_webhook(app)
        await asyncio.sleep(app.state.github_webhook_config["poll_interval"])


# ─── App Lifespan ─────────────────────────────────────────────────────────────
# Creates the Redis client once when the container starts.
# Closes it cleanly when the container stops.
# app.state.redis is then available anywhere in the app.

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    app.state.github_webhook_config = load_github_webhook_config()
    app.state.github_webhook_status = build_github_status_state(app.state.github_webhook_config)
    app.state.github_webhook_lock = asyncio.Lock()
    github_sync_task = None

    if app.state.github_webhook_config["enabled"]:
        github_sync_task = asyncio.create_task(github_webhook_reconciler(app))

    yield
    if github_sync_task:
        github_sync_task.cancel()
        with suppress(asyncio.CancelledError):
            await github_sync_task
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

    # Publish the saved event to Redis channel "webhook:<session_id>"
    event_data = jsonable_encoder(WebhookEventOut.model_validate(event))
    await request.app.state.redis.publish(
        f"webhook:{session_id}",
        json.dumps(event_data),
    )

    # Check if this session has a forwarding URL configured
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
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
        event_data = jsonable_encoder(WebhookEventOut.model_validate(event))
        await request.app.state.redis.publish(
            f"webhook:{session_id}",
            json.dumps(event_data),
        )

    return {"status": "received", "id": event.id}


# ─── GET /hooks/{session_id} ──────────────────────────────────────────────────
# Returns full history from PostgreSQL — used when the dashboard first loads.

@local_control_router.get("/hooks/{session_id}", response_model=List[WebhookEventOut])
def get_webhooks(session_id: str, db: Session = Depends(get_db)):
    return (
        db.query(models.WebhookEvent)
        .filter(models.WebhookEvent.session_id == session_id)
        .order_by(models.WebhookEvent.received_at.desc())
        .all()
    )


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
    raw_body = original.body.encode("utf-8") if original.body else b""
    status, response, error = await forward_webhook(
        config.forward_url,
        raw_body,
        headers=original.headers if isinstance(original.headers, dict) else None,
        query_params=original.query_params if isinstance(original.query_params, dict) else None,
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

@local_control_router.get("/sessions/{session_id}/config", response_model=SessionConfigOut)
def get_session_config(session_id: str, db: Session = Depends(get_db)):
    config = db.query(models.SessionConfig).filter_by(session_id=session_id).first()
    if not config:
        return SessionConfigOut(session_id=session_id, forward_url=None)
    return config


@local_control_router.get("/integrations/github/status", response_model=GitHubWebhookStatusOut)
def get_github_integration_status(request: Request):
    status = dict(request.app.state.github_webhook_status)
    tunnel_url = read_tunnel_url_file()
    status["current_tunnel_url"] = tunnel_url
    status["desired_webhook_url"] = (
        f"{tunnel_url.rstrip('/')}/api/hooks/{status['session_id']}"
        if tunnel_url
        else None
    )
    status.pop("last_successful_url", None)
    return status


@local_control_router.post("/integrations/github/reconcile", response_model=GitHubWebhookStatusOut)
async def trigger_github_reconcile(request: Request):
    status = await reconcile_github_webhook(request.app, force=True)
    response = dict(status)
    response.pop("last_successful_url", None)
    return response


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
