"""Authentication: verify credentials, issue a JWT bound to a seat lease, and
resolve the current user from a token (rejecting released/expired seats)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, verify_password
from app.models.org import SeatLease, User
from app.services import licensing


class AuthError(Exception):
    pass


class PendingApprovalError(AuthError):
    """Raised when a registered user tries to log in before being approved."""


class RejectedError(AuthError):
    """Raised when a rejected user tries to log in."""


def authenticate(db: Session, email: str, password: str) -> User:
    """Look up the user by email (case-insensitive), check the password, and
    gate on approval status."""
    ident = (email or "").strip().lower()
    user = db.scalar(select(User).where(func.lower(User.email) == ident))
    if not user or not verify_password(password, user.password_hash):
        raise AuthError("Invalid email or password.")
    if not user.is_active:
        raise AuthError("Account deactivated. Contact your administrator.")
    if user.approval_status == "pending":
        raise PendingApprovalError(
            "Your account is awaiting administrator approval."
        )
    if user.approval_status == "rejected":
        raise RejectedError("Your registration was rejected by the administrator.")
    return user


def login(db: Session, user: User) -> tuple[str, datetime, str]:
    """Acquire a seat and mint a token. Raises licensing.SeatPoolExhausted if the
    wing's pool is full. Returns (token, expiry, session_id)."""
    session_id = uuid.uuid4().hex
    token, expire = create_access_token(
        subject=str(user.id),
        session_id=session_id,
        claims={"role": user.role.value, "wing_id": user.wing_id, "username": user.username},
    )
    licensing.acquire_seat(
        db, wing_id=user.wing_id, user_id=user.id, session_id=session_id, expires_at=expire
    )
    return token, expire, session_id


def logout(db: Session, session_id: str) -> None:
    licensing.release_seat(db, session_id)


def user_from_claims(db: Session, *, user_id: int, session_id: str) -> User:
    """Resolve + authorize: the user must exist, be active, and still hold a live
    seat lease (so a logged-out / reaped session is rejected)."""
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise AuthError("user not found or inactive")
    lease = db.scalar(select(SeatLease).where(SeatLease.session_id == session_id))
    if not lease or lease.released_at is not None or lease.expires_at <= datetime.now(timezone.utc):
        raise AuthError("session is no longer active")
    return user
