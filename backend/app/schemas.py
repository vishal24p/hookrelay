from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict, Any


class WebhookEventOut(BaseModel):
    id:           int
    session_id:   str
    method:       str
    headers:      Dict[str, Any]
    body:         Optional[str]
    query_params: Optional[Dict[str, Any]]
    received_at:  datetime

    # Forwarding results
    forward_status:   Optional[int]   = None
    forward_response: Optional[str]   = None
    forward_error:    Optional[str]   = None
    forwarded_at:     Optional[datetime] = None

    model_config = {"from_attributes": True}


class SessionConfigIn(BaseModel):
    forward_url: Optional[str] = None


class SessionConfigOut(BaseModel):
    session_id:  str
    forward_url: Optional[str] = None

    model_config = {"from_attributes": True}


class GitHubWebhookStatusOut(BaseModel):
    configured: bool
    enabled: bool
    owner: Optional[str] = None
    repo: Optional[str] = None
    session_id: str
    events: list[str]
    current_tunnel_url: Optional[str] = None
    desired_webhook_url: Optional[str] = None
    managed_hook_id: Optional[int] = None
    last_sync_status: str
    last_sync_error: Optional[str] = None
    last_synced_at: Optional[datetime] = None
