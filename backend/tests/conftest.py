"""
Shared pytest fixtures for the backend test suite.

Tests run against a real, disposable Postgres database
(`trading_platform_test`) on the same server as the app — not SQLite,
since several models use Postgres-specific types (UUID, JSONB). The
DATABASE_URL override below must happen before any `app.*` module is
imported, since `app.config.Settings` reads it at import time.
"""
import os

os.environ["DATABASE_URL"] = "postgresql+asyncpg://postgres:password@postgres:5432/trading_platform_test"
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-only-for-pytest-not-for-production-use-0123456789")

import asyncpg
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.models  # noqa: F401 — registers every model's table with Base
from app.core.security import hash_password
from app.database import Base, get_db
from app.main import app as fastapi_app
from app.models.user import User

TEST_DB_URL = os.environ["DATABASE_URL"]
_ADMIN_DSN = "postgresql://postgres:password@postgres:5432/postgres"


@pytest_asyncio.fixture(scope="session")
async def _test_db_ready():
    """Creates the disposable test database and its schema once per test
    session. Uses its own throwaway engine, fully disposed before yielding —
    pytest-asyncio opens a new event loop per test by default, and a
    session-scoped engine/connection-pool surviving across that loop
    boundary causes asyncpg 'another operation is in progress' errors. The
    per-test `_engine` fixture below creates a fresh engine every test so it
    always matches that test's own loop."""
    conn = await asyncpg.connect(_ADMIN_DSN)
    await conn.execute("DROP DATABASE IF EXISTS trading_platform_test WITH (FORCE)")
    await conn.execute("CREATE DATABASE trading_platform_test")
    await conn.close()

    setup_engine = create_async_engine(TEST_DB_URL)
    async with setup_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await setup_engine.dispose()
    yield


@pytest_asyncio.fixture
async def _engine(_test_db_ready):
    engine = create_async_engine(TEST_DB_URL)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(_engine):
    """Truncates every table before each test so tests never see leftover
    state from a previous one, then hands back a fresh session."""
    async with _engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(table.delete())

    session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_session):
    """httpx AsyncClient wired directly to the FastAPI app (no real socket),
    with the get_db dependency swapped to the per-test session above."""
    async def _override_get_db():
        yield db_session
        await db_session.commit()

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test/api/v1") as ac:
        yield ac
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def make_user(db_session):
    """Factory fixture: make_user() inserts a ready-to-login user directly
    via the DB (bypassing /auth/register) so login/reset tests don't depend
    on the register endpoint working correctly."""
    async def _make(email: str = "user@example.com", password: str = "GoodPass1!", **kwargs) -> User:
        user = User(email=email.lower(), password_hash=hash_password(password), **kwargs)
        db_session.add(user)
        await db_session.flush()
        return user

    return _make
