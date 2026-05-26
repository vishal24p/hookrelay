from sqlalchemy import Column, String, Text, DateTime, Integer
from sqlalchemy.dialects.postgresql import JSON
from datetime import datetime
from .database import Base


class WebhookEvent(Base):
    __tablename__ = "webhook_events"

    id           = Column(Integer, primary_key=True, index=True)
    session_id   = Column(String(100), index=True, nullable=False)
    method       = Column(String(10), nullable=False)
    headers      = Column(JSON, nullable=False)
    body         = Column(Text, nullable=True)
    query_params = Column(JSON, nullable=True)
    received_at  = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Forwarding results
    forward_status   = Column(Integer, nullable=True)
    forward_response = Column(Text, nullable=True)
    forward_error    = Column(Text, nullable=True)
    forwarded_at     = Column(DateTime, nullable=True)


class SessionConfig(Base):
    __tablename__ = "session_configs"

    session_id  = Column(String(100), primary_key=True)
    forward_url = Column(Text, nullable=True)
    provider    = Column(String(32), default="generic", nullable=False)
    razorpay_webhook_secret = Column(Text, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
