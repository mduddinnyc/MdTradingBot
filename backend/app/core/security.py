import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import pyotp
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


# ── Passwords ──────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ── JWT ────────────────────────────────────────────────────────

def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "access"},
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def create_refresh_token() -> tuple[str, str, datetime]:
    """Returns (raw_token, sha256_hash, expiry). Store only the hash."""
    raw = secrets.token_urlsafe(64)
    hashed = _hash_token(raw)
    expires_at = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    return raw, hashed, expires_at


def decode_access_token(token: str) -> str | None:
    """Returns user_id string or None if invalid/expired."""
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        if payload.get("type") != "access":
            return None
        return payload.get("sub")
    except JWTError:
        return None


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_refresh_token(token: str) -> str:
    return _hash_token(token)


# ── TOTP ───────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=settings.TOTP_ISSUER)


def verify_totp(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    # valid_window=1 allows 30s clock skew
    return totp.verify(code, valid_window=1)


# ── Simple symmetric encryption for TOTP secrets ──────────────
# Uses XOR with a derived key — upgrade to Fernet/AES-GCM for production

def _derive_key(length: int) -> bytes:
    """Derives encryption key from JWT_SECRET_KEY."""
    key = hashlib.sha256(settings.JWT_SECRET_KEY.encode()).digest()
    # Extend to required length via repeated hashing
    extended = key
    while len(extended) < length:
        extended += hashlib.sha256(extended).digest()
    return extended[:length]


def encrypt_totp_secret(secret: str) -> str:
    data = secret.encode()
    key = _derive_key(len(data))
    encrypted = bytes(a ^ b for a, b in zip(data, key))
    return encrypted.hex()


def decrypt_totp_secret(encrypted_hex: str) -> str:
    encrypted = bytes.fromhex(encrypted_hex)
    key = _derive_key(len(encrypted))
    decrypted = bytes(a ^ b for a, b in zip(encrypted, key))
    return decrypted.decode()
