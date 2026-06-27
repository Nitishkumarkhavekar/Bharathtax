"""Auth routes: login (acquires a seat), logout (frees it), me, heartbeat."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_current_user, get_principal
from app.core.db import get_db
from app.models.admin import LicenseKey
from app.models.enums import Role
from app.models.org import User
from app.schemas import LoginRequest, MeResponse, TokenResponse
from app.services import audit
from app.services import auth as auth_svc
from app.services import licensing

router = APIRouter(prefix="/auth", tags=["auth"])


# -------- license activation (shown to non-admin users on first login) -------
class LicenseActivateRequest(BaseModel):
    key: str


class LicenseStatusResponse(BaseModel):
    required: bool                # whether THIS user must activate a license
    licensed: bool                # whether they currently hold a valid one
    license_key: str | None = None  # the activated key (last 4 visible client-side)
    assigned_to: str | None = None
    valid_until: datetime | None = None
    message: str | None = None    # human-readable hint when not licensed


def _user_active_license(db: Session, user: User) -> LicenseKey | None:
    """Return the user's currently-valid license, if any.

    A user is considered licensed when there is a LicenseKey row with
    assigned_to == user.username, status == 'active' and valid_until in the
    future. (License rows whose validity has lapsed are flipped to 'expired'
    on read by the admin endpoint, but we also re-check here to be safe.)
    """
    now = datetime.now(timezone.utc)
    lic = db.scalar(
        select(LicenseKey).where(
            LicenseKey.assigned_to == user.username,
            LicenseKey.status == "active",
            LicenseKey.valid_until > now,
        ).order_by(LicenseKey.valid_until.desc())
    )
    return lic


@router.get("/license/status", response_model=LicenseStatusResponse)
def license_status(user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> LicenseStatusResponse:
    # Admins don't need a license to use the admin console.
    if user.role in (Role.super_admin, Role.wing_admin):
        return LicenseStatusResponse(required=False, licensed=True)

    lic = _user_active_license(db, user)
    if lic is None:
        return LicenseStatusResponse(
            required=True, licensed=False,
            message="Please enter your license key to start using BharathTax.",
        )
    return LicenseStatusResponse(
        required=True, licensed=True,
        license_key=lic.key, assigned_to=lic.assigned_to, valid_until=lic.valid_until,
    )


@router.post("/license/activate", response_model=LicenseStatusResponse)
def license_activate(body: LicenseActivateRequest, request: Request,
                     user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)) -> LicenseStatusResponse:
    # Admins don't need this flow.
    if user.role in (Role.super_admin, Role.wing_admin):
        return LicenseStatusResponse(required=False, licensed=True)

    key = (body.key or "").strip().upper().replace(" ", "")
    if not key:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Enter a license key.")

    lic = db.scalar(select(LicenseKey).where(LicenseKey.key == key))
    if not lic:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Unknown license key.")
    if lic.status == "deactivated":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="This license has been deactivated.")
    now = datetime.now(timezone.utc)
    if lic.valid_until <= now:
        # Reflect reality in the row so the admin table doesn't lie.
        lic.status = "expired"
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="This license has expired.")
    if lic.assigned_to and lic.assigned_to != user.username:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"This key is reserved for another user.",
        )

    # Claim it for this user if it wasn't already assigned.
    if not lic.assigned_to:
        lic.assigned_to = user.username
    lic.status = "active"
    db.commit()
    db.refresh(lic)

    audit.log_event(
        db, action="license_activate", user_id=user.id, wing_id=user.wing_id,
        resource_type="license", resource_id=str(lic.id),
        **client_meta(request),
    )
    return LicenseStatusResponse(
        required=True, licensed=True,
        license_key=lic.key, assigned_to=lic.assigned_to, valid_until=lic.valid_until,
    )


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    try:
        user = auth_svc.authenticate(db, body.username, body.password)
    except auth_svc.AuthError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    try:
        token, expire, _sid = auth_svc.login(db, user)
    except licensing.SeatPoolExhausted as e:
        # this is the seat-pool block the brief calls for
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"All {e.limit} seats for your wing are in use. Try again later.",
        )
    cm = client_meta(request)
    audit.log_event(db, action="login", user_id=user.id, wing_id=user.wing_id, **cm)
    return TokenResponse(
        access_token=token, expires_at=expire, role=user.role,
        wing_id=user.wing_id, username=user.username,
    )


@router.post("/logout")
def logout(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    auth_svc.logout(db, p.session_id)
    audit.log_event(db, action="logout", user_id=p.user.id, wing_id=p.user.wing_id)
    return {"ok": True}


@router.post("/heartbeat")
def heartbeat(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    alive = licensing.touch_seat(db, p.session_id)
    return {"alive": alive}


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)) -> User:
    return user
