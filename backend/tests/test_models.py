"""Tests for database models."""
import pytest
from sqlalchemy import text
from app.database import engine
from app import models


class TestDatabaseModels:
    """Test database models."""

    def test_create_tables(self):
        """Test that tables are created correctly."""
        with engine.begin() as connection:
            # Test webhook_events table exists
            result = connection.execute(text("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name='webhook_events'
            """))
            assert result.fetchone() is not None

            # Test session_configs table exists
            result = connection.execute(text("""
                SELECT name FROM sqlite_master
                WHERE type='table' AND name='session_configs'
            """))
            assert result.fetchone() is not None

    def test_webhook_event_model(self, db_session):
        """Test WebhookEvent model."""
        from app.schemas import WebhookEventOut

        event = models.WebhookEvent(
            session_id="test-session",
            method="POST",
            headers={"Content-Type": "application/json"},
            body='{"test": "data"}',
            query_params={"param": "value"},
        )
        db_session.add(event)
        db_session.commit()

        assert event.id is not None
        assert event.session_id == "test-session"

        # Test serialization
        out = WebhookEventOut.model_validate(event)
        assert out.session_id == "test-session"
        assert out.method == "POST"
        assert out.body == '{"test": "data"}'

    def test_session_config_model(self, db_session):
        """Test SessionConfig model."""
        config = models.SessionConfig(
            session_id="test-session",
            forward_url="http://example.com/webhook",
        )
        db_session.add(config)
        db_session.commit()

        assert config.session_id == "test-session"
        assert config.forward_url == "http://example.com/webhook"

        # Test update
        config.forward_url = "http://newexample.com/webhook"
        db_session.commit()

        db_session.refresh(config)
        assert config.forward_url == "http://newexample.com/webhook"