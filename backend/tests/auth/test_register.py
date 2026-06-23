"""Integration tests for POST /auth/register against the real endpoint + DB."""
import pytest
from sqlalchemy import select

from app.models.user import User


def _payload(email="newuser@example.com", password="GoodPass1!", full_name="New User"):
    return {"email": email, "password": password, "full_name": full_name}


# ── Positive ─────────────────────────────────────────────────────

async def test_register_succeeds(client):
    res = await client.post("/auth/register", json=_payload())
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == "newuser@example.com"
    assert body["is_active"] is True
    assert body["totp_enabled"] is False
    assert "password" not in body
    assert "password_hash" not in body


async def test_register_persists_user_with_hashed_password(client, db_session):
    await client.post("/auth/register", json=_payload())
    result = await db_session.execute(select(User).where(User.email == "newuser@example.com"))
    user = result.scalar_one()
    assert user.password_hash != "GoodPass1!"
    assert user.password_hash.startswith("$2")  # bcrypt hash prefix ($2a$/$2b$/$2y$)


# ── Negative ─────────────────────────────────────────────────────

async def test_duplicate_email_rejected(client):
    await client.post("/auth/register", json=_payload(email="dupe@example.com"))
    res = await client.post("/auth/register", json=_payload(email="dupe@example.com"))
    assert res.status_code == 400


async def test_duplicate_email_rejected_case_insensitive(client):
    await client.post("/auth/register", json=_payload(email="Dupe@Example.com"))
    res = await client.post("/auth/register", json=_payload(email="dupe@example.com"))
    assert res.status_code == 400


async def test_invalid_email_format_rejected(client):
    res = await client.post("/auth/register", json=_payload(email="not-an-email"))
    assert res.status_code == 422


@pytest.mark.parametrize("password", [
    "weakpass1!",       # no uppercase
    "WEAKPASS1!",        # no lowercase
    "WeakPassword!",     # no digit
    "WeakPassword1",     # no special char
    "Ab1!",               # too short
])
async def test_weak_password_rejected(client, password):
    res = await client.post("/auth/register", json=_payload(email="weak@example.com", password=password))
    assert res.status_code == 422


# ── Boundary ──────────────────────────────────────────────────────

async def test_password_exactly_8_chars_accepted(client):
    res = await client.post("/auth/register", json=_payload(email="boundary8@example.com", password="Abcd123!"))
    assert res.status_code == 201


async def test_very_long_password_accepted(client):
    long_pw = "A" * 100 + "a1!"
    res = await client.post("/auth/register", json=_payload(email="longpw@example.com", password=long_pw))
    assert res.status_code == 201


async def test_missing_full_name_is_optional(client):
    res = await client.post("/auth/register", json={"email": "noname@example.com", "password": "GoodPass1!"})
    assert res.status_code == 201
    assert res.json()["full_name"] is None


# ── Other ─────────────────────────────────────────────────────────

async def test_unicode_full_name_accepted(client):
    res = await client.post("/auth/register", json=_payload(email="unicode@example.com", full_name="Jürgen Müller 王"))
    assert res.status_code == 201
    assert res.json()["full_name"] == "Jürgen Müller 王"


async def test_default_subscription_tier_is_free(client):
    res = await client.post("/auth/register", json=_payload())
    assert res.json()["subscription_tier"] == "free"
