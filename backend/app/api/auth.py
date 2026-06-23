import base64
import io
import uuid
from datetime import datetime, timezone

import qrcode
from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.core.audit import log as audit_log
from app.core.deps import CurrentUser, DB
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_totp_secret,
    get_totp_uri,
    hash_password,
    hash_refresh_token,
    verify_password,
    verify_totp,
)
from app.models.user import User, UserSession
from app.schemas.auth import (
    LoginRequest,
    MessageResponse,
    RefreshRequest,
    RegisterRequest,
    TOTPEnableRequest,
    TOTPSetupResponse,
    TOTPVerifyRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Register ───────────────────────────────────────────────────

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, request: Request, db: DB):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
    )
    db.add(user)
    await db.flush()

    await audit_log(
        db, action="REGISTER", outcome="success",
        user_id=user.id, resource_type="user", resource_id=user.id, request=request
    )
    return user


# ── Login ──────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: DB):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        await audit_log(
            db, action="LOGIN_FAILURE", outcome="failure",
            metadata={"email": body.email}, request=request
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    # 2FA check
    if user.totp_enabled:
        if not body.totp_code:
            return TokenResponse(
                access_token="", refresh_token="", requires_2fa=True
            )
        secret = decrypt_totp_secret(user.totp_secret_enc)
        if not verify_totp(secret, body.totp_code):
            await audit_log(
                db, action="LOGIN_2FA_FAILURE", outcome="failure",
                user_id=user.id, request=request
            )
            raise HTTPException(status_code=401, detail="Invalid 2FA code")

    raw_refresh, refresh_hash, expires_at = create_refresh_token()

    session = UserSession(
        user_id=user.id,
        refresh_token_hash=refresh_hash,
        expires_at=expires_at,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )
    db.add(session)

    user.last_login_at = datetime.now(timezone.utc)

    await audit_log(
        db, action="LOGIN_SUCCESS", outcome="success",
        user_id=user.id, resource_type="session", resource_id=session.id, request=request
    )

    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        refresh_token=raw_refresh,
    )


# ── Refresh token ──────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, request: Request, db: DB):
    token_hash = hash_refresh_token(body.refresh_token)

    result = await db.execute(
        select(UserSession).where(
            UserSession.refresh_token_hash == token_hash,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(timezone.utc),
        )
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    # Rotate: revoke old, issue new
    session.revoked_at = datetime.now(timezone.utc)

    raw_refresh, refresh_hash, expires_at = create_refresh_token()
    new_session = UserSession(
        user_id=session.user_id,
        refresh_token_hash=refresh_hash,
        expires_at=expires_at,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )
    db.add(new_session)

    await audit_log(
        db, action="TOKEN_REFRESH", outcome="success",
        user_id=session.user_id, resource_type="session", resource_id=new_session.id,
        request=request
    )

    return TokenResponse(
        access_token=create_access_token(str(session.user_id)),
        refresh_token=raw_refresh,
    )


# ── Logout ─────────────────────────────────────────────────────

@router.post("/logout", response_model=MessageResponse)
async def logout(body: RefreshRequest, request: Request, db: DB):
    token_hash = hash_refresh_token(body.refresh_token)

    result = await db.execute(
        select(UserSession).where(UserSession.refresh_token_hash == token_hash)
    )
    session = result.scalar_one_or_none()

    if session and not session.revoked_at:
        session.revoked_at = datetime.now(timezone.utc)
        await audit_log(
            db, action="LOGOUT", outcome="success",
            user_id=session.user_id, request=request
        )

    return MessageResponse(message="Logged out")


# ── Me ─────────────────────────────────────────────────────────

@router.get("/me", response_model=UserResponse)
async def me(current_user: CurrentUser):
    return current_user


# ── 2FA Setup ──────────────────────────────────────────────────

@router.post("/2fa/setup", response_model=TOTPSetupResponse)
async def totp_setup(current_user: CurrentUser, db: DB):
    if current_user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA already enabled")

    secret = generate_totp_secret()
    uri = get_totp_uri(secret, current_user.email)

    # Generate QR code as base64 data URL
    qr = qrcode.make(uri)
    buf = io.BytesIO()
    qr.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()

    # Store encrypted secret temporarily (not enabled until verified)
    current_user.totp_secret_enc = encrypt_totp_secret(secret)
    await db.flush()

    return TOTPSetupResponse(
        secret=secret,
        uri=uri,
        qr_data_url=f"data:image/png;base64,{qr_b64}",
    )


# ── 2FA Enable (confirm with code after setup) ─────────────────

@router.post("/2fa/enable", response_model=MessageResponse)
async def totp_enable(body: TOTPEnableRequest, current_user: CurrentUser, request: Request, db: DB):
    if current_user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA already enabled")

    if not current_user.totp_secret_enc:
        raise HTTPException(status_code=400, detail="Run /2fa/setup first")

    secret = decrypt_totp_secret(current_user.totp_secret_enc)
    if not verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid code")

    current_user.totp_enabled = True
    await audit_log(
        db, action="2FA_ENABLED", outcome="success",
        user_id=current_user.id, request=request
    )

    return MessageResponse(message="2FA enabled")


# ── 2FA Disable ────────────────────────────────────────────────

@router.post("/2fa/disable", response_model=MessageResponse)
async def totp_disable(body: TOTPVerifyRequest, current_user: CurrentUser, request: Request, db: DB):
    if not current_user.totp_enabled:
        raise HTTPException(status_code=400, detail="2FA not enabled")

    secret = decrypt_totp_secret(current_user.totp_secret_enc)
    if not verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="Invalid code")

    current_user.totp_enabled = False
    current_user.totp_secret_enc = None

    await audit_log(
        db, action="2FA_DISABLED", outcome="success",
        user_id=current_user.id, request=request
    )

    return MessageResponse(message="2FA disabled")
