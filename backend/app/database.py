from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
import os

DEFAULT_DATABASE_URL = "postgresql://webhookuser:webhookpass@postgres:5432/webhookdb"


def _is_truthy_env(value: str | None) -> bool:
    return (value or "").strip().lower() in {"true", "1", "yes", "on"}


def _requires_database_url() -> bool:
    hookrelay_env = (os.getenv("HOOKRELAY_ENV") or "").strip().lower()
    return _is_truthy_env(os.getenv("HOOKRELAY_REQUIRE_DATABASE_URL")) or hookrelay_env in {
        "production",
        "prod",
    }


def _resolve_database_url() -> str:
    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if database_url:
        return database_url

    if _requires_database_url():
        raise RuntimeError(
            "DATABASE_URL is required when HOOKRELAY_REQUIRE_DATABASE_URL is true "
            "or HOOKRELAY_ENV is production/prod."
        )

    return DEFAULT_DATABASE_URL


DATABASE_URL = _resolve_database_url()

Base = declarative_base()


def resolve_async_database_url(database_url: str = DATABASE_URL) -> str:
    if database_url.startswith("postgresql+asyncpg://"):
        return database_url
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if database_url.startswith("sqlite+aiosqlite://"):
        return database_url
    if database_url.startswith("sqlite://"):
        return database_url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    return database_url


engine = create_async_engine(resolve_async_database_url())
SessionLocal = async_sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


def get_async_session_factory():
    return SessionLocal


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as db:
        yield db


get_async_db = get_db
