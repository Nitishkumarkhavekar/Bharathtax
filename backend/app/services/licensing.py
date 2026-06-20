"""Seat licensing = CONCURRENT ACTIVE SESSIONS per wing.

A wing has `seat_limit` seats. Login leases one (SeatLease); logout/expiry/reaper
frees it. Login is blocked when live leases reach the limit. This is the control
plane that enforces the per-wing seat pools (e.g. "IT Investigation" = 10).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.org import SeatLease, Wing


class SeatPoolExhausted(Exception):
    def __init__(self, wing_id: int, limit: int) -> None:
        self.wing_id = wing_id
        self.limit = limit
        super().__init__(f"All {limit} seats for wing {wing_id} are in use")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def active_count(db: Session, wing_id: int) -> int:
    return db.scalar(
        select(func.count())
        .select_from(SeatLease)
        .where(
            SeatLease.wing_id == wing_id,
            SeatLease.released_at.is_(None),
            SeatLease.expires_at > _now(),
        )
    ) or 0


def usage(db: Session, wing_id: int) -> dict:
    wing = db.get(Wing, wing_id)
    used = active_count(db, wing_id)
    limit = wing.seat_limit if wing else 0
    return {"wing_id": wing_id, "used": used, "limit": limit, "available": max(0, limit - used)}


def acquire_seat(db: Session, *, wing_id: int, user_id: int, session_id: str,
                 expires_at: datetime) -> SeatLease:
    """Atomically claim a seat or raise SeatPoolExhausted. Row-locks live leases
    for the wing so two simultaneous logins can't both take the last seat."""
    wing = db.get(Wing, wing_id)
    limit = wing.seat_limit if wing else 0

    db.execute(
        select(SeatLease.id)
        .where(
            SeatLease.wing_id == wing_id,
            SeatLease.released_at.is_(None),
            SeatLease.expires_at > _now(),
        )
        .with_for_update()
    ).all()

    if active_count(db, wing_id) >= limit:
        raise SeatPoolExhausted(wing_id, limit)

    lease = SeatLease(
        wing_id=wing_id, user_id=user_id, session_id=session_id, expires_at=expires_at
    )
    db.add(lease)
    db.commit()
    return lease


def release_seat(db: Session, session_id: str) -> bool:
    lease = db.scalar(
        select(SeatLease).where(SeatLease.session_id == session_id, SeatLease.released_at.is_(None))
    )
    if not lease:
        return False
    lease.released_at = _now()
    db.commit()
    return True


def touch_seat(db: Session, session_id: str) -> bool:
    """Heartbeat: a live lease is one that exists, is unreleased, unexpired."""
    lease = db.scalar(select(SeatLease).where(SeatLease.session_id == session_id))
    if not lease or lease.released_at is not None or lease.expires_at <= _now():
        return False
    lease.last_seen_at = _now()
    db.commit()
    return True
