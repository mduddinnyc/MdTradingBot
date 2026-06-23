import re
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator

_SPECIAL_CHARS = re.compile(r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]')


def _validate_password_strength(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    if not any(c.isupper() for c in v):
        raise ValueError("Password must contain at least one uppercase letter")
    if not any(c.islower() for c in v):
        raise ValueError("Password must contain at least one lowercase letter")
    if not any(c.isdigit() for c in v):
        raise ValueError("Password must contain at least one digit")
    if not _SPECIAL_CHARS.search(v):
        raise ValueError("Password must contain at least one special character")
    return v


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    totp_code: str | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    requires_2fa: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password_strength(v)


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    is_active: bool
    is_verified: bool
    totp_enabled: bool
    subscription_tier: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TOTPSetupResponse(BaseModel):
    secret: str
    uri: str
    qr_data_url: str


class TOTPVerifyRequest(BaseModel):
    code: str


class TOTPEnableRequest(BaseModel):
    code: str


class MessageResponse(BaseModel):
    message: str
