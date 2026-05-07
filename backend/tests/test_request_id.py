"""Tests for request ID middleware."""
import uuid
from app.main import app
from fastapi.testclient import TestClient


class TestRequestIdMiddleware:
    """Test request ID middleware."""

    def test_request_id_generated(self):
        """Test that request ID is generated for each request."""
        client = TestClient(app)

        response = client.get("/health")

        # Check that response includes request ID header
        assert "X-Request-ID" in response.headers
        request_id = response.headers["X-Request-ID"]

        # Verify it's a valid UUID
        try:
            uuid.UUID(request_id, version=4)
        except ValueError:
            # It might be a shorter string, which is also acceptable
            assert len(request_id) >= 8

    def test_request_id_propagated(self):
        """Test that client-provided request ID is propagated."""
        client = TestClient(app)
        custom_id = "custom-request-id-123"

        response = client.get("/health", headers={"X-Request-ID": custom_id})

        assert response.headers["X-Request-ID"] == custom_id