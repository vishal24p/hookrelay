"""Tests for rate limiting middleware."""
import pytest
from fastapi.testclient import TestClient
from app.main import app


class TestRateLimiting:
    """Test rate limiting functionality."""

    def test_rate_limit_header_exists(self):
        """Test that rate limit headers are present in responses."""
        client = TestClient(app)

        # Make a request
        response = client.get("/health")

        # Check for rate limit headers
        assert "X-RateLimit-Limit" in response.headers
        assert "X-RateLimit-Remaining" in response.headers
        assert "X-RateLimit-Reset" in response.headers

    def test_health_check_under_limit(self):
        """Test that health check works within rate limit."""
        client = TestClient(app)
        response = client.get("/health")

        assert response.status_code == 200