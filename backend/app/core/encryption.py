"""
Fernet symmetric encryption for broker API credentials.
Key derived from JWT_SECRET_KEY so no separate secret needed in dev.
In production, replace derive_fernet_key() with AWS KMS or Secrets Manager.
"""
import base64
import hashlib

from cryptography.fernet import Fernet

from app.config import settings


def _derive_fernet_key() -> bytes:
    """Derive a 32-byte Fernet key from JWT_SECRET_KEY."""
    raw = hashlib.sha256(
        f"broker-creds-{settings.JWT_SECRET_KEY}".encode()
    ).digest()
    return base64.urlsafe_b64encode(raw)


_fernet = Fernet(_derive_fernet_key())


def encrypt_secret(value: str) -> str:
    """Encrypt a plaintext string → URL-safe base64 ciphertext."""
    return _fernet.encrypt(value.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt ciphertext → plaintext string."""
    return _fernet.decrypt(ciphertext.encode()).decode()
