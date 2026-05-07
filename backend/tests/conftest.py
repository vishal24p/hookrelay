import asyncio
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app, lifespan, get_db
from app.database import get_db as get_db_dependency, Base
from app import models

# Test database URL
TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    """Create a new database session for each test."""
    connection = engine.connect()
    transaction = connection.begin()
    Session = sessionmaker(autocommit=False, autoflush=False, bind=connection)
    db = Session()

    # Create tables
    Base.metadata.create_all(bind=connection)

    yield db

    db.close()
    transaction.rollback()
    connection.close()


@pytest.fixture(scope="function")
def test_app(db_session):
    """Create a test FastAPI app with overridden database dependency."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db_dependency] = override_get_db

    client = TestClient(app)

    yield client

    app.dependency_overrides.clear()


@pytest.fixture
def mock_redis(monkeypatch):
    """Mock Redis for testing without actual Redis connection."""
    class MockRedis:
        def __init__(self):
            self.messages = []
            self.subscribers = {}

        async def publish(self, channel, message):
            self.messages.append({"channel": channel, "message": message})
            return 1

        async def ping(self):
            return True

        async def aclose(self):
            pass

    mock = MockRedis()
    monkeypatch.setattr("app.main.aioredis.from_url", lambda *args, **kwargs: mock)
    return mock


@pytest.fixture
def sample_session_id():
    """Generate a valid session ID for testing."""
    return "test-session-123"


@pytest.fixture
def sample_webhook_body():
    """Sample webhook payload."""
    return {
        "event": "payment.captured",
        "order_id": "order_123",
        "amount": 5000,
        "currency": "USD"
    }
