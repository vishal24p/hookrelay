"""Tests for security features."""
import pytest
from app.main import validate_session_id, is_safe_forward_url


class TestSSRFProtection:
    """Test SSRF protection for forward_url."""

    @pytest.mark.parametrize("url", [
        "http://localhost:3000",
        "http://localhost.localdomain:3000",
        "https://localhost:3000",
        "http://127.0.0.1:3000",
        "http://127.255.255.255:3000",
        "http://10.0.0.1:3000",
        "http://10.255.255.255:3000",
        "http://172.16.0.1:3000",
        "http://172.31.255.255:3000",
        "http://192.168.0.1:3000",
        "http://192.168.255.255:3000",
        "http://169.254.169.254:80",
        "http://169.254.0.1:80",
        "http://0.0.0.0:3000",
        "http://100.64.0.1:3000",
        "http://224.0.0.1:3000",
        "http://240.0.0.1:3000",
    ])
    def test_blocks_internal_ips(self, url):
        """Test that internal IPs are blocked."""
        result, error = is_safe_forward_url(url)
        assert result is False
        assert "not allowed" in error.lower() or "internal" in error.lower()

    @pytest.mark.parametrize("url", [
        "http://example.com",
        "https://example.com",
        "https://api.example.com:8443",
        "http://webhook.local",
    ])
    def test_allows_valid_urls(self, url):
        """Test that valid external URLs are allowed."""
        result, error = is_safe_forward_url(url)
        assert result is True
        assert error is None


class TestSessionIdValidation:
    """Test session ID validation."""

    @pytest.mark.parametrize("session_id", [
        "valid",
        "valid-session",
        "valid_session",
        "ValidSession123",
        "test-1",
        "a1",
        "session" * 20,  # 70 chars - under limit
    ])
    def test_accepts_valid_ids(self, session_id):
        """Test that valid session IDs are accepted."""
        assert validate_session_id(session_id) is True

    @pytest.mark.parametrize("session_id", [
        "",
        "a" * 101,  # Too long
        "invalid session",
        "invalid/session",
        "invalid\\session",
        "invalid.session",
        "invalid.session.name",
        "session@user",
        "session#tag",
        "session<script>",
    ])
    def test_rejects_invalid_ids(self, session_id):
        """Test that invalid session IDs are rejected."""
        assert validate_session_id(session_id) is False