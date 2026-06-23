"""Integration tests for POST /auth/login, /auth/refresh against the real endpoints + DB."""
from app.core.security import generate_totp_secret, encrypt_totp_secret
import pyotp


# ── Positive ─────────────────────────────────────────────────────

async def test_login_succeeds_with_correct_credentials(client, make_user):
    await make_user(email="login@example.com", password="GoodPass1!")
    res = await client.post("/auth/login", json={"email": "login@example.com", "password": "GoodPass1!"})
    assert res.status_code == 200
    body = res.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["requires_2fa"] is False


async def test_login_is_case_insensitive_on_email(client, make_user):
    await make_user(email="caselogin@example.com", password="GoodPass1!")
    res = await client.post("/auth/login", json={"email": "CaseLogin@Example.COM", "password": "GoodPass1!"})
    assert res.status_code == 200


async def test_multiple_concurrent_sessions_allowed(client, make_user):
    await make_user(email="multi@example.com", password="GoodPass1!")
    res1 = await client.post("/auth/login", json={"email": "multi@example.com", "password": "GoodPass1!"})
    res2 = await client.post("/auth/login", json={"email": "multi@example.com", "password": "GoodPass1!"})
    assert res1.status_code == 200 and res2.status_code == 200
    assert res1.json()["refresh_token"] != res2.json()["refresh_token"]


# ── Negative ─────────────────────────────────────────────────────

async def test_wrong_password_returns_generic_401(client, make_user):
    await make_user(email="wrongpw@example.com", password="GoodPass1!")
    res = await client.post("/auth/login", json={"email": "wrongpw@example.com", "password": "WrongPass1!"})
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid credentials"


async def test_nonexistent_email_returns_same_generic_401(client):
    """No email enumeration: wrong-password and no-such-user must look identical."""
    res = await client.post("/auth/login", json={"email": "ghost@example.com", "password": "Whatever1!"})
    assert res.status_code == 401
    assert res.json()["detail"] == "Invalid credentials"


async def test_disabled_account_rejected(client, make_user):
    user = await make_user(email="disabled@example.com", password="GoodPass1!")
    user.is_active = False
    res = await client.post("/auth/login", json={"email": "disabled@example.com", "password": "GoodPass1!"})
    assert res.status_code == 403


async def test_oauth_only_user_cannot_login_with_password(client, db_session):
    """A user with no local password_hash (OAuth-only) must not crash or
    succeed when someone tries email/password login against that account."""
    from app.models.user import User
    user = User(email="oauthonly@example.com", password_hash=None, provider="google", provider_user_id="g-123")
    db_session.add(user)
    await db_session.flush()

    res = await client.post("/auth/login", json={"email": "oauthonly@example.com", "password": "Anything1!"})
    assert res.status_code == 401


async def test_login_requires_totp_when_enabled(client, make_user):
    user = await make_user(email="totp@example.com", password="GoodPass1!")
    secret = generate_totp_secret()
    user.totp_secret_enc = encrypt_totp_secret(secret)
    user.totp_enabled = True

    res = await client.post("/auth/login", json={"email": "totp@example.com", "password": "GoodPass1!"})
    assert res.status_code == 200
    assert res.json()["requires_2fa"] is True
    assert res.json()["access_token"] == ""


async def test_login_with_wrong_totp_code_rejected(client, make_user):
    user = await make_user(email="totpwrong@example.com", password="GoodPass1!")
    secret = generate_totp_secret()
    user.totp_secret_enc = encrypt_totp_secret(secret)
    user.totp_enabled = True

    res = await client.post(
        "/auth/login",
        json={"email": "totpwrong@example.com", "password": "GoodPass1!", "totp_code": "000000"},
    )
    assert res.status_code == 401


async def test_login_with_correct_totp_code_succeeds(client, make_user):
    user = await make_user(email="totpright@example.com", password="GoodPass1!")
    secret = generate_totp_secret()
    user.totp_secret_enc = encrypt_totp_secret(secret)
    user.totp_enabled = True
    code = pyotp.TOTP(secret).now()

    res = await client.post(
        "/auth/login",
        json={"email": "totpright@example.com", "password": "GoodPass1!", "totp_code": code},
    )
    assert res.status_code == 200
    assert res.json()["access_token"]


# ── Refresh token rotation ──────────────────────────────────────

async def test_refresh_rotates_token_and_invalidates_old_one(client, make_user):
    await make_user(email="refresh@example.com", password="GoodPass1!")
    login_res = await client.post("/auth/login", json={"email": "refresh@example.com", "password": "GoodPass1!"})
    old_refresh = login_res.json()["refresh_token"]

    refresh_res = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert refresh_res.status_code == 200
    new_refresh = refresh_res.json()["refresh_token"]
    assert new_refresh != old_refresh

    # Replay of the old (now-rotated) token must fail.
    replay_res = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert replay_res.status_code == 401


async def test_refresh_with_garbage_token_rejected(client):
    res = await client.post("/auth/refresh", json={"refresh_token": "not-a-real-token"})
    assert res.status_code == 401
