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
