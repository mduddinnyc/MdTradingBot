"""
Pure schema-level tests for the password strength validator — no DB, no
HTTP client needed. Integration coverage (policy enforced through the real
endpoints) lives in test_register.py and test_password_reset.py.
"""
import pytest
from pydantic import ValidationError

from app.schemas.auth import RegisterRequest


def _is_valid(password: str) -> bool:
    try:
        RegisterRequest(email="user@example.com", password=password, full_name="Test")
        return True
    except ValidationError:
        return False


# ── Positive ─────────────────────────────────────────────────────

@pytest.mark.parametrize("password", [
    "GoodPass1!",
    "Another$Pass9",
    "Tr4ding!Bot",
    "X" * 100 + "a1!",  # very long, still valid
])
def test_valid_passwords_accepted(password):
    assert _is_valid(password)


# ── Negative — missing each required character class ────────────

@pytest.mark.parametrize("password,missing", [
    ("weakpass1!", "uppercase"),
    ("WEAKPASS1!", "lowercase"),
    ("WeakPassword!", "digit"),
    ("WeakPassword1", "special character"),
])
def test_rejects_password_missing_class(password, missing):
    assert not _is_valid(password)


# ── Boundary ──────────────────────────────────────────────────────

def test_exactly_8_chars_with_all_classes_passes():
    assert _is_valid("Abcd123!")


def test_exactly_7_chars_fails():
    assert not _is_valid("Abcd12!")


def test_empty_password_fails():
    assert not _is_valid("")


# ── Other ─────────────────────────────────────────────────────────

def test_unicode_password_with_all_classes_passes():
    assert _is_valid("Pässwörd1!")


def test_email_is_normalized_to_lowercase():
    req = RegisterRequest(email="Mixed.Case@Example.COM", password="GoodPass1!", full_name="T")
    assert req.email == "mixed.case@example.com"


def test_email_whitespace_is_stripped():
    req = RegisterRequest(email="  user@example.com  ", password="GoodPass1!", full_name="T")
    assert req.email == "user@example.com"
