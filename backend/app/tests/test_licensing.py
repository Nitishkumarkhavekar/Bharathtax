"""Seat-licensing logic (brief requirement): a wing's concurrent-session pool is
enforced — login leases a seat, the pool blocks at the limit, and releasing frees
a seat. DB-backed: runs in the api container against Postgres (`make test`)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models.enums import Role
from app.models.org import Department, SeatLease, User, Wing
from app.services import licensing

WCODE = "TESTW"


def _future():
    return datetime.now(timezone.utc) + timedelta(hours=1)


@pytest.fixture()
def env():
    from sqlalchemy import text as _sql_text
    db = SessionLocal()
    # This suite is DB-backed (real Postgres, in the api container). When no
    # database is reachable — e.g. a local unit-test run on SQLite/without a
    # server — skip cleanly instead of erroring the whole collection.
    try:
        db.execute(_sql_text("SELECT 1"))
    except Exception:
        pytest.skip("test_licensing requires a live Postgres (runs in the api container)")
    # idempotent clean slate for the test wing
    wing = db.scalar(select(Wing).where(Wing.code == WCODE))
    if wing:
        uids = [u.id for u in db.scalars(select(User).where(User.wing_id == wing.id))]
        db.execute(delete(SeatLease).where(SeatLease.wing_id == wing.id))
        if uids:
            db.execute(delete(User).where(User.id.in_(uids)))
        db.execute(delete(Wing).where(Wing.id == wing.id))
        db.commit()
    dept = db.scalar(select(Department).where(Department.name == "TESTDEPT"))
    if not dept:
        dept = Department(name="TESTDEPT")
        db.add(dept)
        db.flush()
    wing = Wing(department_id=dept.id, name="Test Wing", code=WCODE, seat_limit=2)
    db.add(wing)
    db.flush()
    users = [
        User(username=f"t_{WCODE}_{i}", password_hash=hash_password("x"),
             role=Role.officer, wing_id=wing.id)
        for i in range(3)
    ]
    db.add_all(users)
    db.commit()
    yield db, wing, users
    # teardown
    db.execute(delete(SeatLease).where(SeatLease.wing_id == wing.id))
    db.execute(delete(User).where(User.wing_id == wing.id))
    db.execute(delete(Wing).where(Wing.id == wing.id))
    db.commit()
    db.close()


def test_pool_blocks_at_limit(env):
    db, wing, users = env
    licensing.acquire_seat(db, wing_id=wing.id, user_id=users[0].id, session_id="s0", expires_at=_future())
    licensing.acquire_seat(db, wing_id=wing.id, user_id=users[1].id, session_id="s1", expires_at=_future())
    assert licensing.active_count(db, wing.id) == 2

    with pytest.raises(licensing.SeatPoolExhausted):
        licensing.acquire_seat(db, wing_id=wing.id, user_id=users[2].id, session_id="s2",
                               expires_at=_future())


def test_release_frees_a_seat(env):
    db, wing, users = env
    licensing.acquire_seat(db, wing_id=wing.id, user_id=users[0].id, session_id="s0", expires_at=_future())
    licensing.acquire_seat(db, wing_id=wing.id, user_id=users[1].id, session_id="s1", expires_at=_future())
    assert licensing.release_seat(db, "s1") is True
    assert licensing.active_count(db, wing.id) == 1

    # a seat is now free again
    licensing.acquire_seat(db, wing_id=wing.id, user_id=users[2].id, session_id="s2", expires_at=_future())
    assert licensing.active_count(db, wing.id) == 2


def test_usage_reporting(env):
    db, wing, users = env
    licensing.acquire_seat(db, wing_id=wing.id, user_id=users[0].id, session_id="s0", expires_at=_future())
    u = licensing.usage(db, wing.id)
    assert u == {"wing_id": wing.id, "used": 1, "limit": 2, "available": 1}
