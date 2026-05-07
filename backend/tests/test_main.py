"""Tests for main FastAPI endpoints."""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import validate_session_id, is_safe_forward_url


# ─── Validation Tests ──────────────────────────────────────────────────────────
class TestValidation:
    """Test validation functions."""

    @pytest.mark.parametrize("session_id,expected", [
        ("valid-session", True),
        ("valid_session", True),
        ("validSession123", True),
        ("", False),
        ("a" * 101, False),  # Too long
        ("invalid session", False),  # Space
        ("invalid/session", False),  # Slash
        ("invalid\\session", False),  # Backslash
        ("invalid.session", False),  # Dot (not in allowlist)
        ("valid123", True),
    ])
    def test_validate_session_id(self, session_id, expected):
        """Test session ID validation."""
        assert validate_session_id(session_id) == expected

    @pytest.mark.parametrize("url,expected,error_msg", [
        ("http://localhost:3000", False, "Localhost URLs"),
        ("https://localhost.localdomain:3000", False, "Localhost URLs"),
        ("http://127.0.0.1:3000", False, "Internal/private IP"),
        ("http://192.168.1.1:3000", False, "Internal/private IP"),
        ("http://10.0.0.1:3000", False, "Internal/private IP"),
        ("http://172.16.0.1:3000", False, "Internal/private IP"),
        ("http://169.254.169.254:80", False, "Internal/private IP"),
        ("ftp://example.com", False, "Only HTTP and HTTPS"),
        ("http://example.com", True, None),
        ("https://example.com:8443", True, None),
    ])
    def test_is_safe_forward_url(self, url, expected, error_msg):
        """Test SSRF protection."""
        result, error = is_safe_forward_url(url)
        assert result == expected
        if error_msg:
            assert error_msg in error


# ─── Endpoint Tests ───────────────────────────────────────────────────────────
class TestWebhookEndpoints:
    """Test webhook API endpoints."""

    def test_receive_webhook_valid(self, test_app, sample_session_id, sample_webhook_body):
        """Test receiving a valid webhook."""
        response = test_app.post(
            f"/hooks/{sample_session_id}",
            json=sample_webhook_body,
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "received"
        assert "id" in data

    def test_receive_webhook_invalid_session_id(self, test_app):
        """Test receiving a webhook with invalid session ID."""
        invalid_ids = ["invalid session", "a" * 101, "invalid/session"]

        for invalid_id in invalid_ids:
            response = test_app.post(
                f"/hooks/{invalid_id}",
                json={"test": "data"}
            )
            assert response.status_code == 400

    def test_receive_webhook_body_too_large(self, test_app, sample_session_id):
        """Test receiving a webhook that exceeds max body size."""
        # 2MB payload exceeds default 1MB limit
        large_body = {"data": "x" * (2 * 1024 * 1024)}

        response = test_app.post(
            f"/hooks/{sample_session_id}",
            json=large_body,
            headers={"Content-Length": str(2 * 1024 * 1024)}
        )
        assert response.status_code == 413

    def test_get_webhooks(self, test_app, sample_session_id, sample_webhook_body):
        """Test retrieving webhooks for a session."""
        # First, post a webhook
        test_app.post(
            f"/hooks/{sample_session_id}",
            json=sample_webhook_body
        )

        # Then get them
        response = test_app.get(f"/hooks/{sample_session_id}")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_get_webhooks_invalid_session_id(self, test_app):
        """Test getting webhooks with invalid session ID."""
        response = test_app.get("/hooks/invalid session")
        assert response.status_code == 400

    def test_clear_webhooks(self, test_app, sample_session_id, sample_webhook_body):
        """Test clearing webhooks for a session."""
        # First, post some webhooks
        for i in range(3):
            test_app.post(
                f"/hooks/{sample_session_id}",
                json={"index": i, **sample_webhook_body}
            )

        # Clear them
        response = test_app.delete(f"/hooks/{sample_session_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "cleared"
        assert data["deleted_count"] == 3

    def test_delete_session(self, test_app, sample_session_id, sample_webhook_body):
        """Test deleting a session."""
        # First, post a webhook
        test_app.post(
            f"/hooks/{sample_session_id}",
            json=sample_webhook_body
        )

        # Delete the session
        response = test_app.delete(f"/sessions/{sample_session_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "deleted"

    def test_config_endpoint(self, test_app, sample_session_id):
        """Test session configuration endpoints."""
        # Get config (should be empty)
        response = test_app.get(f"/sessions/{sample_session_id}/config")
        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == sample_session_id
        assert data["forward_url"] is None

        # Update config
        response = test_app.put(
            f"/sessions/{sample_session_id}/config",
            json={"forward_url": "http://example.com"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["forward_url"] == "http://example.com"


class TestSessionEndpoints:
    """Test session management endpoints."""

    def test_get_sessions(self, test_app):
        """Test listing all sessions."""
        response = test_app.get("/sessions")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


class TestHealthEndpoint:
    """Test health check endpoint."""

    def test_health_check(self, test_app):
        """Test health check returns status."""
        response = test_app.get("/health")
        assert response.status_code == 200
        data = response.json()
        # Should have at least api and database keys
        assert "api" in data
        assert "database" in data
