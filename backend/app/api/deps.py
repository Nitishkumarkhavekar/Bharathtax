"""FastAPI dependencies: authenticated user, session id, and role guards."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import decode_token
from app.models.admin import LicenseKey
from app.models.enums import Role
from app.models.org import User
from app.services import auth as auth_svc

bearer = HTTPBearer(auto_error=True)


@dataclass
class Principal:
    user: User
    session_id: str


def get_principal(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> Principal:
    try:
        payload = decode_token(creds.credentials)
        user = auth_svc.user_from_claims(
            db, user_id=int(payload["sub"]), session_id=payload["sid"]
        )
    except (jwt.PyJWTError, auth_svc.AuthError, KeyError, ValueError) as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
    return Principal(user=user, session_id=payload["sid"])


def get_current_user(p: Principal = Depends(get_principal)) -> User:
    return p.user


def require_role(*roles: Role) -> Callable[..., User]:
    def guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="insufficient role")
        return user
    return guard


def require_license(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Block officer/auditor users from protected routes until they hold a
    valid license. Admins are exempt.

    Raises HTTP 402 (Payment Required) so the frontend can recognize the
    error and surface the license-activation modal.
    """
    if user.role in (Role.super_admin, Role.wing_admin):
        return user
    now = datetime.now(timezone.utc)
    lic = db.scalar(
        select(LicenseKey).where(
            LicenseKey.assigned_to == user.username,
            LicenseKey.status == "active",
            LicenseKey.valid_until > now,
        )
    )
    if not lic:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="A valid license is required to use this feature.",
        )
    return user


def client_meta(request: Request) -> dict:
    return {
        "ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }
