from pydantic import BaseModel, Field, HttpUrl
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
    forward_failure_kind: Optional[str] = None
    forward_delivery_status: Optional[str] = None
    forwarded_at:     Optional[datetime] = None
    replay_target_event_id: Optional[int] = None
    forward_delivery_message: Optional[str] = None

    provider:            str = "generic"
    provider_event_type: Optional[str] = None
    provider_event_id:   Optional[str] = None
    signature_status:    str = "not_applicable"
    signature_message:   Optional[str] = None
    duplicate_of_id:     Optional[int] = None
    is_local_fixture: bool = False
    fixture_source: Optional[str] = None
    fixture_key: Optional[str] = None
    razorpay_payment_id: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    razorpay_refund_id: Optional[str] = None
    razorpay_subscription_id: Optional[str] = None

    model_config = {"from_attributes": True}


class SessionConfigIn(BaseModel):
    forward_url: Optional[HttpUrl] = None
    provider: Optional[str] = None
    razorpay_webhook_secret: Optional[str] = None
    rotate_auth_token: bool = False


class SessionConfigOut(BaseModel):
    session_id:  str
    forward_url: Optional[str] = None
    provider: str = "generic"
    razorpay_webhook_secret_configured: bool = False
    auth_token_configured: bool = False
    auth_token: Optional[str] = None
    forward_url_warnings: list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class RazorpayFixtureRequestOut(BaseModel):
    fixture_key: str
    label: str
    headers: Dict[str, Any]
    body: str
    signature_generated: bool = False
