"""Desktop-app session tracking + admin log view.

Officer side:
  POST /desktop/session/start   → open a session on sign-in
  POST /desktop/session/heartbeat → update last_action + counters
  POST /desktop/session/end     → mark ended_at on sign-out

Admin side:
  GET /admin/desktop-sessions            → paginated list of sessions
  GET /admin/desktop-sessions/summary    → per-user rollup for the log page
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.models.desktop_session import DesktopSession
from app.models.enums import Role
from app.models.org import User

router = APIRouter(prefix="/desktop/session", tags=["desktop-session"])


class SessionStart(BaseModel):
    client_version: str | None = Field(default=None, max_length=20)


class SessionHeartbeat(BaseModel):
    session_token: str
    last_action: str | None = Field(default=None, max_length=120)
    action_count_delta: int = Field(default=0, ge=0, le=1000)


class SessionEnd(BaseModel):
    session_token: str


@router.post("/start")
def start_session(body: SessionStart, request: Request,
                  p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> dict:
    tok = secrets.token_urlsafe(24)
    s = DesktopSession(
        user_id=p.user.id,
        session_token=tok,
        client_version=body.client_version,
        ip_address=(request.client.host if request.client else None),
        user_agent=(request.headers.get("user-agent") or "")[:400],
    )
    db.add(s); db.commit(); db.refresh(s)
    return {"session_token": tok, "id": s.id}


@router.post("/heartbeat")
def heartbeat(body: SessionHeartbeat,
              p: Principal = Depends(get_principal),
              db: Session = Depends(get_db)) -> dict:
    s = db.scalar(select(DesktopSession).where(
        DesktopSession.session_token == body.session_token,
        DesktopSession.user_id == p.user.id,
    ))
    if not s:
        raise HTTPException(404, "Session not found")
    now = datetime.now(timezone.utc)
    if body.last_action:
        s.last_action = body.last_action[:120]
        s.last_action_at = now
    if body.action_count_delta:
        s.action_count = (s.action_count or 0) + body.action_count_delta
    db.commit()
    return {"ok": True}


@router.post("/end")
def end_session(body: SessionEnd,
                p: Principal = Depends(get_principal),
                db: Session = Depends(get_db)) -> dict:
    s = db.scalar(select(DesktopSession).where(
        DesktopSession.session_token == body.session_token,
        DesktopSession.user_id == p.user.id,
    ))
    if not s:
        raise HTTPException(404, "Session not found")
    if s.ended_at is None:
        s.ended_at = datetime.now(timezone.utc)
        db.commit()
    return {"ok": True}


# =============== Admin listing ================
admin_router = APIRouter(prefix="/admin/desktop-sessions", tags=["admin", "desktop-session"])


def _admin(user: User = Depends(lambda p=Depends(get_principal): p.user)) -> User:
    if user.role not in (Role.super_admin, Role.wing_admin):
        raise HTTPException(403, "Admin access required")
    return user


def _session_out(s: DesktopSession, user: User | None) -> dict:
    ended = s.ended_at
    started = s.started_at
    duration_s = int((ended or datetime.now(timezone.utc)) .timestamp() - started.timestamp()) if started else None
    return {
        "id": s.id,
        "user_id": s.user_id,
        "username": user.username if user else None,
        "full_name": user.full_name if user else None,
        "email": user.email if user else None,
        "client_version": s.client_version,
        "ip_address": s.ip_address,
        "started_at": started.isoformat() if started else None,
        "ended_at": ended.isoformat() if ended else None,
        "duration_seconds": duration_s,
        "still_open": ended is None,
        "last_action": s.last_action,
        "last_action_at": s.last_action_at.isoformat() if s.last_action_at else None,
        "action_count": s.action_count or 0,
    }


@admin_router.get("")
def list_sessions(user_id: int | None = None, limit: int = 200,
                  admin: User = Depends(_admin),
                  db: Session = Depends(get_db)) -> dict:
    q = select(DesktopSession).order_by(desc(DesktopSession.started_at)).limit(limit)
    if user_id is not None:
        q = q.where(DesktopSession.user_id == user_id)
    if admin.role == Role.wing_admin:
        q = q.join(User, User.id == DesktopSession.user_id).where(User.wing_id == admin.wing_id)
    rows = db.scalars(q).all()
    users_by_id = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.user_id for r in rows if r.user_id})))}
    return {"sessions": [_session_out(r, users_by_id.get(r.user_id) if r.user_id else None) for r in rows]}


@admin_router.get("/summary")
def per_user_summary(admin: User = Depends(_admin),
                     db: Session = Depends(get_db)) -> dict:
    """One row per user: total sessions, total minutes, last activity."""
    now = datetime.now(timezone.utc)
    # Fetch all sessions in-memory; count expected in low thousands per wing.
    q = select(DesktopSession)
    if admin.role == Role.wing_admin:
        q = q.join(User, User.id == DesktopSession.user_id).where(User.wing_id == admin.wing_id)
    all_rows = list(db.scalars(q))

    by_user: dict[int, dict] = {}
    for s in all_rows:
        if s.user_id is None: continue
        d = by_user.setdefault(s.user_id, {"sessions": 0, "seconds": 0, "actions": 0,
                                            "last_started_at": None, "last_ended_at": None,
                                            "open_sessions": 0, "last_action": None,
                                            "last_action_at": None})
        d["sessions"] += 1
        d["actions"] += s.action_count or 0
        ended = s.ended_at or now
        started = s.started_at
        if started:
            d["seconds"] += int(ended.timestamp() - started.timestamp())
            if d["last_started_at"] is None or (started > datetime.fromisoformat(d["last_started_at"])):
                d["last_started_at"] = started.isoformat()
        if s.ended_at is None:
            d["open_sessions"] += 1
        elif d["last_ended_at"] is None or (s.ended_at > datetime.fromisoformat(d["last_ended_at"])):
            d["last_ended_at"] = s.ended_at.isoformat()
        if s.last_action_at and (d["last_action_at"] is None or s.last_action_at > datetime.fromisoformat(d["last_action_at"])):
            d["last_action"] = s.last_action
            d["last_action_at"] = s.last_action_at.isoformat()

    if by_user:
        users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(list(by_user))))}
    else:
        users = {}
    out = []
    for uid, d in by_user.items():
        u = users.get(uid)
        out.append({
            "user_id": uid,
            "username": u.username if u else None,
            "full_name": u.full_name if u else None,
            "email": u.email if u else None,
            "role": u.role if u else None,
            **d,
        })
    out.sort(key=lambda r: (r["last_started_at"] or ""), reverse=True)
    return {"users": out}
