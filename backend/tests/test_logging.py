"""Tests for logging functionality."""
import logging
import io
import sys
from app.main import logger


class TestLogging:
    """Test logging configuration."""

    def test_logger_exists(self):
        """Test that logger is properly configured."""
        assert logger is not None
        assert logger.name == "hookrelay"

    def test_logger_has_handlers(self):
        """Test that logger has at least one handler."""
        assert len(logger.handlers) >= 1

    def test_logger_informational_level(self):
        """Test that logger level is set correctly."""
        assert logger.level <= logging.INFO