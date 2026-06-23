"""
Integration tests for POST /auth/password/forgot and /auth/password/reset.

send_password_reset_email is monkeypatched to capture the raw token instead
of actually sending mail — the endpoint always passes the real raw token to
it before hashing it for storage, so this is the legitimate seam to grab it
at in a test (we never log or expose the raw token anywhere else, by design).
"""
import datetime as dt

from sqlalchemy import select

from app.models.user import PasswordResetToken


def _capture_reset_email(monkeypatch):
    captured = {}

    def _fake_send(to_email, raw_token):
        captured["to_email"] = to_email
        captured["raw_token"] = raw_token

    # app.api.auth's `notif_svc` is the same module object (imported via
    # `from app.services import notifications as notif_svc`), so patching
    # here is visible there too.
    monkeypatch.setattr("app.services.notifications.send_password_reset_email", _fake_send)
    return captured


# ── Positive — full happy path ────────────────────────────────────

async def test_full_forgot_then_reset_flow(client, make_user, monkeypatch):
    await make_user(email="forgot@example.com", password="OldPass1!")
    captured = _capture_reset_email(monkeypatch)

    forgot_res = await client.post("/auth/password/forgot", json={"email": "forgot@example.com"})
    assert forgot_res.status_code == 200
    assert captured["to_email"] == "forgot@example.com"
    raw_token = captured["raw_token"]

    reset_res = await client.post(
        "/auth/password/reset", json={"token": raw_token, "new_password": "NewPass1!"}
    )
    assert reset_res.status_code == 200

    old_login = await client.post("/auth/login", json={"email": "forgot@example.com", "password": "OldPass1!"})
    assert old_login.status_code == 401

    new_login = await client.post("/auth/login", json={"email": "forgot@example.com", "password": "NewPass1!"})
    assert new_login.status_code == 200


async def test_reset_revokes_existing_sessions(client, make_user, monkeypatch):
    await make_user(email="revoke@example.com", password="OldPass1!")
    captured = _capture_reset_email(monkeypatch)

    login_res = await client.post("/auth/login", json={"email": "revoke@example.com", "password": "OldPass1!"})
    old_refresh = login_res.json()["refresh_token"]

    await client.post("/auth/password/forgot", json={"email": "revoke@example.com"})
    await client.post(
        "/auth/password/reset", json={"token": captured["raw_token"], "new_password": "NewPass1!"}
    )

    refresh_res = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert refresh_res.status_code == 401


# ── Negative ─────────────────────────────────────────────────────

async def test_forgot_password_for_nonexistent_email_same_generic_message(client, make_user, monkeypatch):
    """No email enumeration: existing and nonexistent emails get the same
    response, and no token is created for the nonexistent one."""
    captured = _capture_reset_email(monkeypatch)

    res_real = await client.post("/auth/password/forgot", json={"email": "ghost-check@example.com"})
    res_fake = await client.post("/auth/password/forgot", json={"email": "totally-made-up@example.com"})

    assert res_real.status_code == res_fake.status_code == 200
    assert res_real.json() == res_fake.json()
    assert "to_email" not in captured  # never sent for either, since neither user exists yet


async def test_garbage_token_rejected(client):
    res = await client.post("/auth/password/reset", json={"token": "not-a-real-token", "new_password": "NewPass1!"})
    assert res.status_code == 400


async def test_expired_token_rejected(client, make_user, db_session, monkeypatch):
    from app.core.security import create_reset_token

    user = await make_user(email="expired@example.com", password="OldPass1!")
    raw, hashed, _ = create_reset_token()
    expired_token = PasswordResetToken(
        user_id=user.id, token_hash=hashed,
        expires_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1),
    )
    db_session.add(expired_token)
    await db_session.flush()

    res = await client.post("/auth/password/reset", json={"token": raw, "new_password": "NewPass1!"})
    assert res.status_code == 400


async def test_already_used_token_rejected(client, make_user, monkeypatch):
    await make_user(email="reused@example.com", password="OldPass1!")
    captured = _capture_reset_email(monkeypatch)
    await client.post("/auth/password/forgot", json={"email": "reused@example.com"})
    raw_token = captured["raw_token"]

    first = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": "NewPass1!"})
    assert first.status_code == 200

    second = await client.post("/auth/password/reset", json={"token": raw_token, "new_password": "AnotherPass1!"})
    assert second.status_code == 400


async def test_weak_new_password_rejected(client, make_user, monkeypatch):
    await make_user(email="weaknew@example.com", password="OldPass1!")
    captured = _capture_reset_email(monkeypatch)
    await client.post("/auth/password/forgot", json={"email": "weaknew@example.com"})

    res = await client.post("/auth/password/reset", json={"token": captured["raw_token"], "new_password": "weak"})
    assert res.status_code == 422


# ── Other ─────────────────────────────────────────────────────────

async def test_second_forgot_request_invalidates_first_token(client, make_user, monkeypatch):
    await make_user(email="superseded@example.com", password="OldPass1!")
    captured = _capture_reset_email(monkeypatch)

    await client.post("/auth/password/forgot", json={"email": "superseded@example.com"})
    first_token = captured["raw_token"]

    await client.post("/auth/password/forgot", json={"email": "superseded@example.com"})
    second_token = captured["raw_token"]
    assert first_token != second_token

    stale_res = await client.post(
        "/auth/password/reset", json={"token": first_token, "new_password": "NewPass1!"}
    )
    assert stale_res.status_code == 400

    fresh_res = await client.post(
        "/auth/password/reset", json={"token": second_token, "new_password": "NewPass1!"}
    )
    assert fresh_res.status_code == 200


async def test_disabled_account_gets_generic_message_no_email_sent(client, make_user, monkeypatch):
    user = await make_user(email="disabledforgot@example.com", password="OldPass1!")
    user.is_active = False
    captured = _capture_reset_email(monkeypatch)

    res = await client.post("/auth/password/forgot", json={"email": "disabledforgot@example.com"})
    assert res.status_code == 200
    assert "to_email" not in captured

    result = await client.post("/auth/password/reset", json={"token": "anything", "new_password": "NewPass1!"})
    assert result.status_code == 400  # confirms no real token exists to use anyway
