"""Admin console: dashboard, user/admin/license/revenue CRUD, model + server stats.

Authorization model:
- super_admin : full access
- wing_admin  : scoped to its own wing for users/admins; can read dashboard
                metrics & seat usage for its wing; cannot manage licenses or
                revenue (that's super_admin only).
"""
from __future__ import annotations

import os
import platform
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query as Q, status
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.db import get_db
from app.core.security import hash_password
from app.models.activity import Query
from app.models.admin import LicenseKey, RevenueEntry
from app.models.corpus import CorpusChunk
from app.models.enums import Role
from app.models.org import SeatLease, User, Wing
from app.models.token_usage import TokenUsage
from app.schemas import (
    DashboardOut,
    LicenseCreate,
    LicenseOut,
    LicenseUpdate,
    ModelInfoOut,
    ModelManagementOut,
    RevenueCreate,
    RevenueOut,
    RevenueUpdate,
    SeatUsageOut,
    ServerStatsOut,
    UserCreate,
    UserOut,
    UserUpdate,
    WingCreate,
    WingOut,
)
from app.services import licensing

router = APIRouter(prefix="/admin", tags=["admin"])


def _admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in (Role.super_admin, Role.wing_admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin only")
    return user


def _super(user: User = Depends(get_current_user)) -> User:
    if user.role != Role.super_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="super_admin only")
    return user


def _scope_wing(admin: User, wing_id: int) -> None:
    if admin.role == Role.wing_admin and admin.wing_id != wing_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="not your wing")


# ---------- wings ----------
@router.get("/wings", response_model=list[WingOut])
def list_wings(admin: User = Depends(_admin), db: Session = Depends(get_db)) -> list[Wing]:
    stmt = select(Wing)
    if admin.role == Role.wing_admin:
        stmt = stmt.where(Wing.id == admin.wing_id)
    return list(db.scalars(stmt))


@router.post("/wings", response_model=WingOut)
def create_wing(body: WingCreate, db: Session = Depends(get_db),
                admin: User = Depends(_super)) -> Wing:
    wing = Wing(department_id=body.department_id, name=body.name, code=body.code,
                seat_limit=body.seat_limit)
    db.add(wing); db.commit()
    return wing


@router.get("/wings/{wing_id}/seats", response_model=SeatUsageOut)
def seat_usage(wing_id: int, admin: User = Depends(_admin), db: Session = Depends(get_db)) -> dict:
    _scope_wing(admin, wing_id)
    return licensing.usage(db, wing_id)


# ---------- users ----------
@router.get("/users", response_model=list[UserOut])
def list_users(
    wing_id: int | None = None,
    role: str | None = None,
    q: str | None = None,
    approval_status: str | None = None,
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
) -> list[User]:
    target = admin.wing_id if admin.role == Role.wing_admin else wing_id
    stmt = select(User).order_by(User.id.desc())
    if target is not None:
        stmt = stmt.where(User.wing_id == target)
    if role:
        try:
            role_enum = Role(role)
            stmt = stmt.where(User.role == role_enum)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="bad role")
    if approval_status:
        if approval_status not in ("pending", "approved", "rejected"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="bad approval_status")
        stmt = stmt.where(User.approval_status == approval_status)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(
            func.lower(User.username).like(like)
            | func.lower(func.coalesce(User.full_name, "")).like(like)
            | func.lower(func.coalesce(User.email, "")).like(like)
        )
    return list(db.scalars(stmt))


@router.post("/users", response_model=UserOut)
def create_user(body: UserCreate, admin: User = Depends(_admin),
                db: Session = Depends(get_db)) -> User:
    _scope_wing(admin, body.wing_id)
    if admin.role == Role.wing_admin and body.role == Role.super_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="cannot create super_admin")
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="username exists")
    user = User(
        username=body.username, password_hash=hash_password(body.password),
        full_name=body.full_name, email=body.email, role=body.role,
        wing_id=body.wing_id, office_id=body.office_id,
    )
    db.add(user); db.commit(); db.refresh(user)
    return user


@router.get("/users/{user_id}", response_model=UserOut)
def get_user(user_id: int, admin: User = Depends(_admin),
             db: Session = Depends(get_db)) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _scope_wing(admin, user.wing_id)
    return user


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, admin: User = Depends(_admin),
                db: Session = Depends(get_db)) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _scope_wing(admin, user.wing_id)
    if body.wing_id is not None:
        _scope_wing(admin, body.wing_id)
        user.wing_id = body.wing_id
    if body.role is not None:
        if admin.role == Role.wing_admin and body.role == Role.super_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="cannot promote to super_admin")
        user.role = body.role
    if body.full_name is not None: user.full_name = body.full_name
    if body.email is not None: user.email = body.email
    if body.office_id is not None: user.office_id = body.office_id
    if body.is_active is not None: user.is_active = body.is_active
    if body.password: user.password_hash = hash_password(body.password)
    db.commit(); db.refresh(user)
    return user


@router.post("/users/{user_id}/approve", response_model=UserOut)
def approve_user(user_id: int, admin: User = Depends(_admin),
                 db: Session = Depends(get_db)) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _scope_wing(admin, user.wing_id)
    user.approval_status = "approved"
    user.is_active = True
    user.approved_by_user_id = admin.id
    user.approved_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(user)
    return user


@router.post("/users/{user_id}/reject", response_model=UserOut)
def reject_user(user_id: int, admin: User = Depends(_admin),
                db: Session = Depends(get_db)) -> User:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _scope_wing(admin, user.wing_id)
    user.approval_status = "rejected"
    user.is_active = False
    user.approved_by_user_id = admin.id
    user.approved_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, admin: User = Depends(_admin),
                db: Session = Depends(get_db)) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    _scope_wing(admin, user.wing_id)
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="cannot delete yourself")
    # Free any seat leases first to avoid FK issues.
    db.query(SeatLease).filter(SeatLease.user_id == user.id).delete()
    db.delete(user); db.commit()


# ---------- corpus (kept for ingestion controls) ----------
@router.get("/corpus/stats")
def corpus_stats(admin: User = Depends(_admin), db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        select(CorpusChunk.domain, func.count(CorpusChunk.id))
        .where(CorpusChunk.is_current.is_(True)).group_by(CorpusChunk.domain)
    ).all()
    by_domain = {str(d.value if hasattr(d, "value") else d): n for d, n in rows}
    return {"chunks": sum(by_domain.values()), "by_domain": by_domain}


@router.post("/corpus/ingest-case-law")
def ingest_case_law(admin: User = Depends(_super)) -> dict:
    from app.ingestion.tasks import ingest_case_law as task
    task.delay("/data/manual/case_law")
    return {"started": True, "path": "/data/manual/case_law",
            "note": "Drop judgment PDFs (and optional manifest.jsonl) in data/manual/case_law/ first."}


# ---------- dashboard ----------
@router.get("/dashboard", response_model=DashboardOut)
def dashboard(admin: User = Depends(_admin), db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)

    users_total = int(db.scalar(select(func.count(User.id))) or 0)
    users_active = int(db.scalar(select(func.count(User.id)).where(User.is_active.is_(True))) or 0)
    pending_approvals = int(db.scalar(
        select(func.count(User.id)).where(User.approval_status == "pending")
    ) or 0)
    admins = int(db.scalar(
        select(func.count(User.id)).where(User.role.in_([Role.super_admin, Role.wing_admin]))
    ) or 0)

    queries_24h = int(db.scalar(select(func.count(Query.id)).where(Query.created_at >= day_ago)) or 0)
    queries_7d = int(db.scalar(select(func.count(Query.id)).where(Query.created_at >= week_ago)) or 0)
    queries_total = int(db.scalar(select(func.count(Query.id))) or 0)

    avg_latency = db.scalar(select(func.avg(Query.latency_ms)).where(Query.created_at >= week_ago))
    avg_latency_ms = float(avg_latency) if avg_latency is not None else None

    # 14-day daily series
    day_rows = db.execute(
        select(
            func.date_trunc("day", Query.created_at).label("day"),
            func.count(Query.id),
        )
        .where(Query.created_at >= now - timedelta(days=14))
        .group_by("day").order_by("day")
    ).all()
    queries_per_day = [
        {"day": (d.date().isoformat() if hasattr(d, "date") else str(d)), "count": int(c)}
        for d, c in day_rows
    ]

    # Top recent questions (7d)
    top_rows = db.execute(
        select(Query.question, func.count(Query.id).label("c"))
        .where(Query.created_at >= week_ago)
        .group_by(Query.question)
        .order_by(desc("c")).limit(5)
    ).all()
    top_questions = [{"question": q, "count": int(c)} for q, c in top_rows]

    revenue_month = float(db.scalar(
        select(func.coalesce(func.sum(RevenueEntry.amount), 0))
        .where(RevenueEntry.entry_date >= month_start)
    ) or 0)
    revenue_total = float(db.scalar(
        select(func.coalesce(func.sum(RevenueEntry.amount), 0))
    ) or 0)

    lic_rows = db.execute(
        select(LicenseKey.status, func.count(LicenseKey.id)).group_by(LicenseKey.status)
    ).all()
    lic_counts = {s: int(c) for s, c in lic_rows}

    # Seats: sum across all wings the admin can see.
    wing_stmt = select(Wing)
    if admin.role == Role.wing_admin:
        wing_stmt = wing_stmt.where(Wing.id == admin.wing_id)
    seats_total = 0
    seats_used = 0
    for w in db.scalars(wing_stmt):
        u = licensing.usage(db, w.id)
        seats_total += int(u.get("limit", 0))
        seats_used += int(u.get("used", 0))

    return {
        "users_total": users_total,
        "users_active": users_active,
        "pending_approvals": pending_approvals,
        "admins": admins,
        "queries_24h": queries_24h,
        "queries_7d": queries_7d,
        "queries_total": queries_total,
        "avg_latency_ms": avg_latency_ms,
        "revenue_month": revenue_month,
        "revenue_total": revenue_total,
        "licenses_active": lic_counts.get("active", 0),
        "licenses_expired": lic_counts.get("expired", 0),
        "licenses_deactivated": lic_counts.get("deactivated", 0),
        "seats_used": seats_used,
        "seats_total": seats_total,
        "queries_per_day": queries_per_day,
        "top_questions": top_questions,
    }


# ---------- model management ----------
def _fetch_litellm_models() -> tuple[list[str], str | None]:
    """Pull the live model list from the configured LiteLLM endpoint."""
    if settings.llm_backend == "mock":
        return [settings.llm_model_name], None
    try:
        with httpx.Client(timeout=8.0) as c:
            r = c.get(
                settings.llm_base_url.rstrip("/") + "/models",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            )
            r.raise_for_status()
            data = r.json().get("data", [])
            return [m.get("id") for m in data if m.get("id")], None
    except Exception as e:
        return [], str(e)[:200]


@router.get("/model", response_model=ModelManagementOut)
def model_management(admin: User = Depends(_admin), db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(days=1)
    week_ago = now - timedelta(days=7)

    models, last_error = _fetch_litellm_models()
    if not models:
        models = [m for m in [settings.llm_model_name, settings.llm_fallback_model_name] if m]

    # Aggregate ask metrics from Query rows (we don't model per-row model name
    # yet, so attribute all to the primary; fallback gets zeros — wired through
    # the schema for forward compat).
    queries_total = int(db.scalar(select(func.count(Query.id))) or 0)
    queries_24h = int(db.scalar(select(func.count(Query.id)).where(Query.created_at >= day_ago)) or 0)
    queries_7d = int(db.scalar(select(func.count(Query.id)).where(Query.created_at >= week_ago)) or 0)
    avg_latency = db.scalar(select(func.avg(Query.latency_ms)).where(Query.created_at >= week_ago))
    grounded_count = int(db.scalar(
        select(func.count(Query.id))
        .where(Query.created_at >= week_ago, Query.retrieval_meta["grounded"].as_boolean().is_(True))
    ) or 0)
    success_rate = (grounded_count / queries_7d * 100) if queries_7d else 100.0

    out: list[ModelInfoOut] = []
    for mid in models:
        is_primary = mid == settings.llm_model_name
        is_fallback = mid == settings.llm_fallback_model_name
        out.append(ModelInfoOut(
            id=mid,
            queries_total=queries_total if is_primary else 0,
            queries_24h=queries_24h if is_primary else 0,
            queries_7d=queries_7d if is_primary else 0,
            avg_latency_ms=float(avg_latency) if (is_primary and avg_latency is not None) else None,
            success_rate=success_rate if is_primary else 100.0,
            is_primary=is_primary,
            is_fallback=is_fallback,
        ))

    day_rows = db.execute(
        select(
            func.date_trunc("day", Query.created_at).label("day"),
            func.count(Query.id),
            func.avg(Query.latency_ms),
        )
        .where(Query.created_at >= now - timedelta(days=14))
        .group_by("day").order_by("day")
    ).all()
    queries_per_day = [
        {"day": (d.date().isoformat() if hasattr(d, "date") else str(d)), "count": int(c)}
        for d, c, _ in day_rows
    ]
    latency_per_day = [
        {"day": (d.date().isoformat() if hasattr(d, "date") else str(d)),
         "latency_ms": float(lat) if lat is not None else 0}
        for d, _, lat in day_rows
    ]

    return {
        "backend": settings.llm_backend,
        "base_url": settings.llm_base_url,
        "primary_model": settings.llm_model_name,
        "fallback_model": settings.llm_fallback_model_name or None,
        "models": [m.model_dump() for m in out],
        "queries_per_day": queries_per_day,
        "latency_per_day": latency_per_day,
        "last_error": last_error,
        "healthy": last_error is None,
    }


# ---------- server stats ----------
def _docker_containers() -> list[dict]:
    try:
        sock = "/var/run/docker.sock"
        if not os.path.exists(sock):
            return []
        transport = httpx.HTTPTransport(uds=sock)
        with httpx.Client(transport=transport, base_url="http://docker", timeout=4.0) as c:
            r = c.get("/v1.41/containers/json", params={"all": "true"})
            r.raise_for_status()
            return [
                {
                    "name": (j.get("Names") or ["?"])[0].lstrip("/"),
                    "status": j.get("State", "?"),
                    "image": j.get("Image", "?"),
                }
                for j in r.json()
            ]
    except Exception:
        return []


def _llm_health() -> tuple[bool, float | None]:
    if settings.llm_backend == "mock":
        return True, None
    try:
        t0 = time.time()
        with httpx.Client(timeout=5.0) as c:
            r = c.get(
                settings.llm_base_url.rstrip("/") + "/models",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            )
            ok = r.status_code < 400
        return ok, (time.time() - t0) * 1000
    except Exception:
        return False, None


@router.get("/model/server", response_model=ServerStatsOut)
def server_stats(admin: User = Depends(_admin)) -> dict:
    try:
        import psutil
    except ImportError:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="psutil missing")

    cpu_pct = psutil.cpu_percent(interval=0.4)
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    disk = psutil.disk_usage("/")
    boot = psutil.boot_time()
    net = psutil.net_io_counters()
    load = list(getattr(psutil, "getloadavg", lambda: (0.0, 0.0, 0.0))())

    healthy = cpu_pct < 95 and mem.percent < 95 and disk.percent < 95
    llm_ok, llm_lat = _llm_health()

    return {
        "healthy": healthy,
        "cpu_percent": float(cpu_pct),
        "cpu_count": int(psutil.cpu_count(logical=True) or 1),
        "load_avg": [float(x) for x in load],
        "mem_total_mb": mem.total / (1024 ** 2),
        "mem_used_mb": mem.used / (1024 ** 2),
        "mem_percent": float(mem.percent),
        "swap_used_mb": swap.used / (1024 ** 2),
        "swap_percent": float(swap.percent),
        "disk_total_gb": disk.total / (1024 ** 3),
        "disk_used_gb": disk.used / (1024 ** 3),
        "disk_percent": float(disk.percent),
        "uptime_seconds": int(time.time() - boot),
        "process_count": len(psutil.pids()),
        "network_bytes_sent": int(net.bytes_sent),
        "network_bytes_recv": int(net.bytes_recv),
        "containers": _docker_containers(),
        "llm_endpoint_healthy": llm_ok,
        "llm_endpoint_latency_ms": llm_lat,
    }


# ---------- licenses ----------
def _gen_license_key() -> str:
    """Return a friendly BHTX-XXXX-XXXX-XXXX-XXXX style key."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    chunks = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(4)]
    return "BHTX-" + "-".join(chunks)


def _refresh_license_status(lic: LicenseKey) -> None:
    if lic.status == "deactivated":
        return
    now = datetime.now(timezone.utc)
    lic.status = "active" if lic.valid_until > now else "expired"


@router.get("/licenses", response_model=list[LicenseOut])
def list_licenses(admin: User = Depends(_super), db: Session = Depends(get_db)) -> list[LicenseKey]:
    rows = list(db.scalars(select(LicenseKey).order_by(LicenseKey.id.desc())))
    for r in rows:
        _refresh_license_status(r)
    db.commit()
    return rows


@router.post("/licenses", response_model=LicenseOut)
def create_license(body: LicenseCreate, admin: User = Depends(_super),
                   db: Session = Depends(get_db)) -> LicenseKey:
    valid_from = body.valid_from or datetime.now(timezone.utc)
    if body.valid_until <= valid_from:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="valid_until must be after valid_from")
    # Generate unique key (retry on rare collision)
    for _ in range(5):
        candidate = _gen_license_key()
        if not db.scalar(select(LicenseKey).where(LicenseKey.key == candidate)):
            break
    else:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail="key generation failed")
    lic = LicenseKey(
        key=candidate, valid_from=valid_from, valid_until=body.valid_until,
        assigned_to=body.assigned_to, notes=body.notes, status="active",
        created_by_user_id=admin.id,
    )
    db.add(lic); db.commit(); db.refresh(lic)
    return lic


@router.put("/licenses/{lic_id}", response_model=LicenseOut)
def update_license(lic_id: int, body: LicenseUpdate, admin: User = Depends(_super),
                   db: Session = Depends(get_db)) -> LicenseKey:
    lic = db.get(LicenseKey, lic_id)
    if not lic:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if body.valid_until is not None: lic.valid_until = body.valid_until
    if body.assigned_to is not None: lic.assigned_to = body.assigned_to
    if body.notes is not None: lic.notes = body.notes
    if body.status is not None:
        if body.status not in ("active", "expired", "deactivated"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="bad status")
        lic.status = body.status
    if lic.status != "deactivated":
        _refresh_license_status(lic)
    db.commit(); db.refresh(lic)
    return lic


@router.post("/licenses/{lic_id}/deactivate", response_model=LicenseOut)
def deactivate_license(lic_id: int, admin: User = Depends(_super),
                       db: Session = Depends(get_db)) -> LicenseKey:
    lic = db.get(LicenseKey, lic_id)
    if not lic:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    lic.status = "deactivated"
    db.commit(); db.refresh(lic)
    return lic


@router.delete("/licenses/{lic_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_license(lic_id: int, admin: User = Depends(_super),
                   db: Session = Depends(get_db)) -> None:
    lic = db.get(LicenseKey, lic_id)
    if not lic:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    db.delete(lic); db.commit()


# ---------- revenue ----------
@router.get("/revenue", response_model=list[RevenueOut])
def list_revenue(
    limit: int = Q(200, ge=1, le=1000),
    admin: User = Depends(_super),
    db: Session = Depends(get_db),
) -> list[RevenueEntry]:
    return list(db.scalars(
        select(RevenueEntry).order_by(RevenueEntry.entry_date.desc(), RevenueEntry.id.desc()).limit(limit)
    ))


@router.post("/revenue", response_model=RevenueOut)
def create_revenue(body: RevenueCreate, admin: User = Depends(_super),
                   db: Session = Depends(get_db)) -> RevenueEntry:
    if body.amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="amount must be positive")
    entry = RevenueEntry(
        entry_date=body.entry_date or datetime.now(timezone.utc),
        source=body.source, description=body.description,
        amount=body.amount, currency=body.currency,
        license_key_id=body.license_key_id,
        created_by_user_id=admin.id,
    )
    db.add(entry); db.commit(); db.refresh(entry)
    return entry


@router.put("/revenue/{rid}", response_model=RevenueOut)
def update_revenue(rid: int, body: RevenueUpdate, admin: User = Depends(_super),
                   db: Session = Depends(get_db)) -> RevenueEntry:
    e = db.get(RevenueEntry, rid)
    if not e:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if body.entry_date is not None: e.entry_date = body.entry_date
    if body.source is not None: e.source = body.source
    if body.description is not None: e.description = body.description
    if body.amount is not None:
        if body.amount <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="amount must be positive")
        e.amount = body.amount
    if body.currency is not None: e.currency = body.currency
    if body.license_key_id is not None: e.license_key_id = body.license_key_id
    db.commit(); db.refresh(e)
    return e


@router.delete("/revenue/{rid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_revenue(rid: int, admin: User = Depends(_super),
                   db: Session = Depends(get_db)) -> None:
    e = db.get(RevenueEntry, rid)
    if not e:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    db.delete(e); db.commit()


@router.get("/revenue/summary")
def revenue_summary(admin: User = Depends(_super), db: Session = Depends(get_db)) -> dict[str, Any]:
    """12-month rollup keyed by YYYY-MM."""
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc) - timedelta(days=365)
    rows = db.execute(
        select(
            func.date_trunc("month", RevenueEntry.entry_date).label("m"),
            func.sum(RevenueEntry.amount),
        )
        .where(RevenueEntry.entry_date >= start)
        .group_by("m").order_by("m")
    ).all()
    series = [
        {"month": (m.date().isoformat()[:7] if hasattr(m, "date") else str(m)[:7]),
         "amount": float(amt or 0)}
        for m, amt in rows
    ]
    return {"by_month": series, "currency": "INR"}


# kept so existing platform.* import lints clean
_ = platform.python_version


# ---------- token usage (admin) --------------------------------------------
@router.get("/token-usage")
def admin_token_usage(
    days: int = Q(30, ge=1, le=365),
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Aggregate token spend across all users, for the admin console."""
    now = datetime.now(timezone.utc)
    d1 = now - timedelta(days=1)
    d7 = now - timedelta(days=7)
    dW = now - timedelta(days=days)

    totals = db.execute(
        select(
            func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
            func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            func.count(TokenUsage.id),
            func.count(func.distinct(TokenUsage.user_id)),
        )
    ).one()

    tokens_24h = int(db.scalar(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.created_at >= d1)
    ) or 0)
    tokens_7d = int(db.scalar(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.created_at >= d7)
    ) or 0)
    tokens_window = int(db.scalar(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.created_at >= dW)
    ) or 0)

    # Per-user leaderboard — return EVERY user who ever spent tokens; the
    # frontend paginates client-side.  The old top-50 cap made the table
    # useless when the department scaled past a couple of dozen officers.
    per_user_rows = db.execute(
        select(
            User.id, User.username, User.full_name, User.email,
            func.count(TokenUsage.id),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
            func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
        )
        .join(TokenUsage, TokenUsage.user_id == User.id)
        .group_by(User.id, User.username, User.full_name, User.email)
        .order_by(func.sum(TokenUsage.total_tokens).desc())
    ).all()
    per_user = [
        {"user_id": uid, "username": un, "full_name": fn, "email": em,
         "calls": int(c), "total_tokens": int(t),
         "prompt_tokens": int(p), "completion_tokens": int(cc)}
        for uid, un, fn, em, c, t, p, cc in per_user_rows
    ]

    # Per-action breakdown
    per_action_rows = db.execute(
        select(
            TokenUsage.action,
            func.count(TokenUsage.id),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
        )
        .group_by(TokenUsage.action)
        .order_by(func.sum(TokenUsage.total_tokens).desc())
    ).all()
    per_action = [
        {"action": a, "calls": int(c), "tokens": int(t)} for a, c, t in per_action_rows
    ]

    # Per-model breakdown
    per_model_rows = db.execute(
        select(
            TokenUsage.model,
            func.count(TokenUsage.id),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
        )
        .group_by(TokenUsage.model)
        .order_by(func.sum(TokenUsage.total_tokens).desc())
    ).all()
    per_model = [
        {"model": m, "calls": int(c), "tokens": int(t)} for m, c, t in per_model_rows
    ]

    # Daily time series
    per_day_rows = db.execute(
        select(
            func.date_trunc("day", TokenUsage.created_at).label("day"),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            func.count(TokenUsage.id),
        )
        .where(TokenUsage.created_at >= dW)
        .group_by("day").order_by("day")
    ).all()
    per_day = [
        {"day": (d.date().isoformat() if hasattr(d, "date") else str(d)),
         "tokens": int(t), "calls": int(c)}
        for d, t, c in per_day_rows
    ]

    return {
        "prompt_tokens": int(totals[0]),
        "completion_tokens": int(totals[1]),
        "total_tokens": int(totals[2]),
        "calls": int(totals[3]),
        "active_users": int(totals[4] or 0),
        "tokens_24h": tokens_24h,
        "tokens_7d": tokens_7d,
        "tokens_window": tokens_window,
        "window_days": days,
        "per_user": per_user,
        "per_action": per_action,
        "per_model": per_model,
        "per_day": per_day,
    }


@router.get("/users/{user_id}/token-usage")
def admin_user_token_usage(
    user_id: int,
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Same shape as /auth/token-usage but for any user (admin-viewable)."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    _scope_wing(admin, user.wing_id)

    now = datetime.now(timezone.utc)
    d1 = now - timedelta(days=1)
    d7 = now - timedelta(days=7)
    d30 = now - timedelta(days=30)

    totals = db.execute(
        select(
            func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
            func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            func.count(TokenUsage.id),
        ).where(TokenUsage.user_id == user_id)
    ).one()

    tokens_24h = int(db.scalar(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.user_id == user_id, TokenUsage.created_at >= d1)
    ) or 0)
    tokens_7d = int(db.scalar(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.user_id == user_id, TokenUsage.created_at >= d7)
    ) or 0)

    by_action = [
        {"action": a, "calls": int(c), "tokens": int(t)}
        for a, c, t in db.execute(
            select(
                TokenUsage.action,
                func.count(TokenUsage.id),
                func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            )
            .where(TokenUsage.user_id == user_id)
            .group_by(TokenUsage.action)
            .order_by(func.sum(TokenUsage.total_tokens).desc())
        ).all()
    ]
    by_model = [
        {"model": m, "calls": int(c), "tokens": int(t)}
        for m, c, t in db.execute(
            select(
                TokenUsage.model,
                func.count(TokenUsage.id),
                func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            )
            .where(TokenUsage.user_id == user_id)
            .group_by(TokenUsage.model)
            .order_by(func.sum(TokenUsage.total_tokens).desc())
        ).all()
    ]
    per_day_rows = db.execute(
        select(
            func.date_trunc("day", TokenUsage.created_at).label("day"),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            func.count(TokenUsage.id),
        )
        .where(TokenUsage.user_id == user_id, TokenUsage.created_at >= d30)
        .group_by("day").order_by("day")
    ).all()
    per_day = [
        {"day": (d.date().isoformat() if hasattr(d, "date") else str(d)),
         "tokens": int(t), "calls": int(c)}
        for d, t, c in per_day_rows
    ]

    return {
        "user": {"id": user.id, "username": user.username,
                 "full_name": user.full_name, "email": user.email,
                 "role": user.role.value if hasattr(user.role, "value") else str(user.role)},
        "prompt_tokens": int(totals[0]),
        "completion_tokens": int(totals[1]),
        "total_tokens": int(totals[2]),
        "calls": int(totals[3]),
        "tokens_24h": tokens_24h,
        "tokens_7d": tokens_7d,
        "by_action": by_action,
        "by_model": by_model,
        "per_day": per_day,
    }


# ============================================================ Gemini monitoring
@router.get("/gemini")
def admin_gemini_stats(
    days: int = Q(30, ge=1, le=365),
    admin: User = Depends(_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Detailed Gemini-API health & spend for the admin console.

    Aggregates every `token_usage` row whose `model` matches the configured
    Gemini model — that's the source of truth since we bill every Gemini
    call through the same `tokens.record()` path as LiteLLM.
    """
    import os as _os
    gemini_model = _os.getenv("GEMINI_SEARCH_MODEL", "gemini-flash-latest")
    key_configured = bool((_os.getenv("GEMINI_API_KEY") or "").strip())
    web_search_enabled = _os.getenv("WEB_SEARCH_ENABLED", "1").lower() not in (
        "0", "false", "no", ""
    )

    now = datetime.now(timezone.utc)
    d24 = now - timedelta(hours=24)
    d7 = now - timedelta(days=7)
    dW = now - timedelta(days=days)

    # Base filter: any row where model looks like Gemini (accept prefix
    # match so gemini-flash-latest / gemini-1.5-pro / etc. all count).
    gemini_filter = TokenUsage.model.ilike("gemini%")

    # Overall totals (all time)
    totals = db.execute(
        select(
            func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
            func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            func.count(TokenUsage.id),
            func.count(func.distinct(TokenUsage.user_id)),
            func.coalesce(func.avg(TokenUsage.latency_ms), 0),
        ).where(gemini_filter)
    ).one()

    tokens_24h = int(db.scalar(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(gemini_filter, TokenUsage.created_at >= d24)
    ) or 0)
    calls_24h = int(db.scalar(
        select(func.count(TokenUsage.id))
        .where(gemini_filter, TokenUsage.created_at >= d24)
    ) or 0)
    tokens_7d = int(db.scalar(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(gemini_filter, TokenUsage.created_at >= d7)
    ) or 0)
    tokens_window = int(db.scalar(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(gemini_filter, TokenUsage.created_at >= dW)
    ) or 0)

    # Per-day series in the window
    per_day_rows = db.execute(
        select(
            func.date_trunc("day", TokenUsage.created_at).label("day"),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            func.count(TokenUsage.id),
        )
        .where(gemini_filter, TokenUsage.created_at >= dW)
        .group_by("day").order_by("day")
    ).all()
    per_day = [
        {
            "day": (d.date().isoformat() if hasattr(d, "date") else str(d)),
            "tokens": int(t),
            "calls": int(c),
        }
        for d, t, c in per_day_rows
    ]

    # Per-model variant breakdown (in case a deploy uses more than one
    # Gemini SKU over time).
    per_model = [
        {"model": m, "calls": int(c), "tokens": int(t)}
        for m, c, t in db.execute(
            select(
                TokenUsage.model,
                func.count(TokenUsage.id),
                func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            )
            .where(gemini_filter)
            .group_by(TokenUsage.model)
            .order_by(func.sum(TokenUsage.total_tokens).desc())
        ).all()
    ]

    # Per-user leaderboard (all users, sorted, no cap).
    per_user_rows = db.execute(
        select(
            User.id, User.username, User.full_name, User.email,
            func.count(TokenUsage.id),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
            func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
            func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
            func.coalesce(func.avg(TokenUsage.latency_ms), 0),
        )
        .join(TokenUsage, TokenUsage.user_id == User.id)
        .where(gemini_filter)
        .group_by(User.id, User.username, User.full_name, User.email)
        .order_by(func.sum(TokenUsage.total_tokens).desc())
    ).all()
    per_user = [
        {"user_id": uid, "username": un, "full_name": fn, "email": em,
         "calls": int(c), "total_tokens": int(t),
         "prompt_tokens": int(p), "completion_tokens": int(cc),
         "avg_latency_ms": int(avg or 0)}
        for uid, un, fn, em, c, t, p, cc, avg in per_user_rows
    ]

    # Per-action — which BharathTax feature is driving Gemini spend.
    per_action_rows = db.execute(
        select(
            TokenUsage.action,
            func.count(TokenUsage.id),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0),
        )
        .where(gemini_filter)
        .group_by(TokenUsage.action)
        .order_by(func.sum(TokenUsage.total_tokens).desc())
    ).all()
    per_action = [
        {"action": a, "calls": int(c), "tokens": int(t)}
        for a, c, t in per_action_rows
    ]

    # Most recent Gemini calls — for a debug "trail" panel.
    recent_rows = db.execute(
        select(
            TokenUsage.id,
            TokenUsage.user_id,
            User.username,
            User.full_name,
            TokenUsage.action,
            TokenUsage.model,
            TokenUsage.prompt_tokens,
            TokenUsage.completion_tokens,
            TokenUsage.total_tokens,
            TokenUsage.latency_ms,
            TokenUsage.created_at,
        )
        .join(User, User.id == TokenUsage.user_id, isouter=True)
        .where(gemini_filter)
        .order_by(TokenUsage.id.desc())
        .limit(500)
    ).all()
    recent = [
        {
            "id": rid, "user_id": uid, "username": un, "full_name": fn,
            "action": act, "model": mdl,
            "prompt_tokens": int(pt), "completion_tokens": int(ct),
            "total_tokens": int(tt),
            "latency_ms": (int(lat) if lat is not None else None),
            "created_at": (ca.isoformat() if hasattr(ca, "isoformat") else str(ca)),
        }
        for rid, uid, un, fn, act, mdl, pt, ct, tt, lat, ca in recent_rows
    ]

    return {
        # Config / health
        "configured": key_configured,
        "web_search_enabled": web_search_enabled,
        "model": gemini_model,
        # Totals (all time)
        "prompt_tokens": int(totals[0]),
        "completion_tokens": int(totals[1]),
        "total_tokens": int(totals[2]),
        "calls": int(totals[3]),
        "active_users": int(totals[4] or 0),
        "avg_latency_ms": int(totals[5] or 0),
        # Recent activity
        "calls_24h": calls_24h,
        "tokens_24h": tokens_24h,
        "tokens_7d": tokens_7d,
        "tokens_window": tokens_window,
        "window_days": days,
        # Breakdowns
        "per_day": per_day,
        "per_model": per_model,
        "per_user": per_user,
        "per_action": per_action,
        "recent": recent,
    }
