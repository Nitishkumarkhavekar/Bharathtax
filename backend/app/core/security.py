"""Password hashing (bcrypt) and JWT encode/decode. No business logic here."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings

# bcrypt hard-limits the secret to 72 bytes; truncate defensively (passwords are
# short in practice). Used directly instead of passlib, which is unmaintained and
# breaks against bcrypt 4.x.
_MAX_BCRYPT_BYTES = 72


def hash_password(plain: str) -> str:
    secret = plain.encode("utf-8")[:_MAX_BCRYPT_BYTES]
    return bcrypt.hashpw(secret, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    secret = plain.encode("utf-8")[:_MAX_BCRYPT_BYTES]
    try:
        return bcrypt.checkpw(secret, hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(subject: str, *, session_id: str, claims: dict[str, Any]) -> tuple[str, datetime]:
    """Return (token, expiry). `session_id` ties the token to a seat lease."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict[str, Any] = {
        "sub": subject,
        "sid": session_id,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        **claims,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expire


def decode_token(token: str) -> dict[str, Any]:
    """Raises jwt.PyJWTError on invalid/expired tokens. `leeway` tolerates small
    clock skew between containers (e.g. WSL2 drift after sleep/restart), which
    otherwise trips the iat/nbf 'token not yet valid' check intermittently."""
    return jwt.decode(
        token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], leeway=30
    )
