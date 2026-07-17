"""Auth routes: login (acquires a seat), logout (frees it), me, heartbeat."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from datetime import timedelta

from app.api.deps import Principal, client_meta, get_current_user, get_principal
from app.core.db import get_db
from app.core.security import hash_password, verify_password
from app.models.admin import LicenseKey
from app.models.enums import Role
from app.models.org import User, Wing
from app.models.token_usage import TokenUsage
from sqlalchemy import func as _func
from app.schemas import (
    LoginRequest,
    MeResponse,
    ProfileOut,
    ProfileUpdate,
    PublicWingOut,
    RegisterRequest,
    RegisterResponse,
    TokenResponse,
)
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
    pending_key: str | None = None  # the user's auto-generated (unassigned) trial key


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
        # Surface the user's auto-generated trial key (minted at signup, still
        # unassigned) so the activation dialog can pre-fill it and the profile
        # can display it — no manual copy/paste needed.
        now = datetime.now(timezone.utc)
        pending = db.scalar(
            select(LicenseKey).where(
                LicenseKey.assigned_to.is_(None),
                LicenseKey.status == "active",
                LicenseKey.valid_until > now,
                LicenseKey.notes == f"Trial license for {user.username}",
            ).order_by(LicenseKey.id.desc())
        )
        pkey = pending.key if pending else None
        if pkey is None:
            # Account has no trial key yet (e.g. created before trials existed) —
            # mint one now so the activation dialog always has a key to show and
            # pre-fill. Idempotent: skips the subscription if one already exists.
            try:
                from app.services.provisioning import provision_trial
                pkey = provision_trial(db, user)
                db.commit()
            except Exception:
                db.rollback()
                pkey = None
        return LicenseStatusResponse(
            required=True, licensed=False,
            pending_key=pkey,
            message=None if pkey else "Please enter your license key to start using BharathTax.",
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
    email = (body.email or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Enter a valid email address.")
    try:
        user = auth_svc.authenticate(db, email, body.password)
    except auth_svc.PendingApprovalError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=str(e))
    except auth_svc.RejectedError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail=str(e))
    except auth_svc.AuthError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=str(e) or "invalid credentials")
    try:
        token, expire, _sid = auth_svc.login(db, user)
    except licensing.SeatPoolExhausted as e:
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


# -------- public registration + wings list ---------------------------------
@router.get("/wings", response_model=list[PublicWingOut])
def list_wings_public(db: Session = Depends(get_db)) -> list[Wing]:
    """Wings list exposed unauthenticated so the registration form can show
    which wing the new user belongs to."""
    return list(db.scalars(select(Wing).order_by(Wing.name)))


@router.post("/register", response_model=RegisterResponse)
def register(body: RegisterRequest, request: Request,
             db: Session = Depends(get_db)) -> RegisterResponse:
    email = (body.email or "").strip().lower()
    if "@" not in email or "." not in email.split("@", 1)[-1]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Enter a valid email address.")
    if len(body.password or "") < 6:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters.",
        )

    # Email and derived username must both be unique.
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="An account already exists for this email.")
    base_username = email.split("@", 1)[0]
    username = base_username
    n = 1
    while db.scalar(select(User).where(User.username == username)):
        n += 1
        username = f"{base_username}{n}"

    # Wings are an admin concept (seat scope). New self-service registrations
    # land in the first available wing; the admin can move them later.
    default_wing = db.scalar(select(Wing).order_by(Wing.id))
    if not default_wing:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The deployment isn't configured yet. Contact your administrator.",
        )

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(body.password),
        full_name=body.full_name or None,
        organisation=(body.organisation or "").strip() or None,
        role=Role.officer,
        wing_id=default_wing.id,
        is_active=True,
        approval_status="approved",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    audit.log_event(
        db, action="register", user_id=user.id, wing_id=user.wing_id,
        **client_meta(request),
    )
    # Auto-provision: free-trial subscription (100K tokens) + a license key the
    # user activates by pasting it on first login.
    from app.services.provisioning import provision_trial, TRIAL_TOKENS
    lic_key = provision_trial(db, user)
    db.commit()
    return RegisterResponse(
        id=user.id,
        email=user.email or email,
        full_name=user.full_name,
        approval_status=user.approval_status,
        license_key=lic_key,
        trial_tokens=TRIAL_TOKENS,
        message=(
            "Account created and approved. Your free trial with 100,000 tokens is active. "
            "Save your license key below and paste it when you sign in to start using BharathTax."
        ),
    )


# -------- profile (current user) --------------------------------------------
@router.get("/profile", response_model=ProfileOut)
def get_profile(user: User = Depends(get_current_user)) -> User:
    return user


@router.put("/profile", response_model=ProfileOut)
def update_profile(body: ProfileUpdate,
                   user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> User:
    if body.full_name is not None:
        user.full_name = body.full_name.strip() or None
    if body.organisation is not None:
        user.organisation = body.organisation.strip() or None
    if body.new_password:
        if len(body.new_password) < 6:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="New password must be at least 6 characters.",
            )
        if not body.current_password or not verify_password(
            body.current_password, user.password_hash
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="Your current password is incorrect.",
            )
        user.password_hash = hash_password(body.new_password)
    db.commit()
    db.refresh(user)
    return user


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


# -------- personal token usage -------------------------------------------
class _TokenSummaryOut(BaseModel):
    """User-facing summary. Model identifiers are deliberately NOT included —
    users see spend attributed to their task ("ask", "improve_prompt",
    "appeal.module1", …), never to a specific gateway model."""
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    calls: int
    tokens_24h: int
    tokens_7d: int
    tokens_30d: int
    by_action: list[dict]
    per_day: list[dict]
    recent: list[dict]


@router.get("/token-usage", response_model=_TokenSummaryOut)
def my_token_usage(user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> _TokenSummaryOut:
    """Aggregate token spend for the calling user."""
    now = datetime.now(timezone.utc)
    d1 = now - timedelta(days=1)
    d7 = now - timedelta(days=7)
    d30 = now - timedelta(days=30)

    base = select(TokenUsage).where(TokenUsage.user_id == user.id)

    totals_row = db.execute(
        select(
            _func.coalesce(_func.sum(TokenUsage.prompt_tokens), 0),
            _func.coalesce(_func.sum(TokenUsage.completion_tokens), 0),
            _func.coalesce(_func.sum(TokenUsage.total_tokens), 0),
            _func.count(TokenUsage.id),
        ).where(TokenUsage.user_id == user.id)
    ).one()

    tokens_24h = int(db.scalar(
        select(_func.coalesce(_func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.user_id == user.id, TokenUsage.created_at >= d1)
    ) or 0)
    tokens_7d = int(db.scalar(
        select(_func.coalesce(_func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.user_id == user.id, TokenUsage.created_at >= d7)
    ) or 0)
    tokens_30d = int(db.scalar(
        select(_func.coalesce(_func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.user_id == user.id, TokenUsage.created_at >= d30)
    ) or 0)

    by_action_rows = db.execute(
        select(
            TokenUsage.action,
            _func.count(TokenUsage.id),
            _func.coalesce(_func.sum(TokenUsage.total_tokens), 0),
        )
        .where(TokenUsage.user_id == user.id)
        .group_by(TokenUsage.action)
        .order_by(_func.sum(TokenUsage.total_tokens).desc())
    ).all()
    by_action = [
        {"action": a, "calls": int(c), "tokens": int(t)} for a, c, t in by_action_rows
    ]

    # NOTE: intentionally NOT computing a by_model breakdown here. Model
    # identities are an implementation detail we don't surface to end users.

    per_day_rows = db.execute(
        select(
            _func.date_trunc("day", TokenUsage.created_at).label("day"),
            _func.coalesce(_func.sum(TokenUsage.total_tokens), 0),
            _func.count(TokenUsage.id),
        )
        .where(TokenUsage.user_id == user.id, TokenUsage.created_at >= now - timedelta(days=30))
        .group_by("day").order_by("day")
    ).all()
    per_day = [
        {"day": (d.date().isoformat() if hasattr(d, "date") else str(d)),
         "tokens": int(t), "calls": int(c)}
        for d, t, c in per_day_rows
    ]

    # ------------------------------------------------------------------
    # Recent activity — merge sibling rows from the same user question.
    #
    # A single Ask-bot question can produce SEVERAL rows in `token_usage`:
    # the primary corpus model, an optional llama fallback, and (very often)
    # a Gemini web-search fallback. Users don't need to see the plumbing —
    # they need one row per question with the TOTAL spend it cost, so the
    # Gemini token count is visible instead of drowning in zero-token
    # primary-model rows.
    #
    # We over-fetch a wider window, then greedily collapse rows that share
    # the same (user, action) and land within 30 s of each other into a
    # single aggregate row.  Model identifiers stay scrubbed (they were
    # never in the response), so the merge is invisible to the client.
    # ------------------------------------------------------------------
    raw = list(db.scalars(
        base.order_by(TokenUsage.id.desc()).limit(120)
    ))
    merged: list[dict] = []
    MERGE_WINDOW_S = 30.0
    for r in raw:
        if merged:
            last = merged[-1]
            same_action = last["action"] == r.action
            last_dt = last["_dt"]
            gap = (last_dt - r.created_at).total_seconds() if r.created_at and last_dt else 999
            if same_action and 0 <= gap <= MERGE_WINDOW_S:
                # Sum tokens onto the existing entry; keep the newer
                # timestamp (which is `last`) so ordering stays stable.
                last["prompt_tokens"] += int(r.prompt_tokens or 0)
                last["completion_tokens"] += int(r.completion_tokens or 0)
                last["total_tokens"] += int(r.total_tokens or 0)
                # Latency: keep the max (the slowest call dominated the
                # user-perceived wait).
                if r.latency_ms is not None:
                    prev = last.get("latency_ms") or 0
                    last["latency_ms"] = max(prev, int(r.latency_ms))
                continue
        merged.append({
            "id": r.id,
            "action": r.action,
            "prompt_tokens": int(r.prompt_tokens or 0),
            "completion_tokens": int(r.completion_tokens or 0),
            "total_tokens": int(r.total_tokens or 0),
            "latency_ms": (int(r.latency_ms) if r.latency_ms is not None else None),
            "created_at_iso": r.created_at.isoformat() if r.created_at else None,
            "_dt": r.created_at,
        })
    # Drop rows where the underlying gateway didn't report any tokens.
    # Those aren't "free calls" — they're gaps in the telemetry, and users
    # find a wall of 0-token rows confusing (the by-task aggregates and
    # KPI cards still count every call, so nothing is lost).
    spent = [m for m in merged if m["total_tokens"] > 0]
    # Trim to the client-facing size and strip the internal `_dt` key.
    recent = [
        {"id": m["id"], "action": m["action"],
         "prompt_tokens": m["prompt_tokens"],
         "completion_tokens": m["completion_tokens"],
         "total_tokens": m["total_tokens"],
         "latency_ms": m["latency_ms"],
         "created_at": m["created_at_iso"]}
        for m in spent[:50]
    ]

    return _TokenSummaryOut(
        prompt_tokens=int(totals_row[0]),
        completion_tokens=int(totals_row[1]),
        total_tokens=int(totals_row[2]),
        calls=int(totals_row[3]),
        tokens_24h=tokens_24h,
        tokens_7d=tokens_7d,
        tokens_30d=tokens_30d,
        by_action=by_action,
        per_day=per_day,
        recent=recent,
    )
