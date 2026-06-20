"""Seed demo org + users so the vertical slice is runnable:
  Department > 2 Wings (with seat pools) > officers + a wing admin + super admin.

Idempotent: re-running won't duplicate. Passwords are demo-only — change them.
Run:  python -m app.scripts.seed
"""
from __future__ import annotations

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.logging import configure_logging, get_logger
from app.core.security import hash_password
from app.models.enums import Role
from app.models.org import Department, User, Wing

log = get_logger(__name__)

DEMO = [
    # username, password, role, wing_code, full_name
    ("admin", "admin123", Role.super_admin, "ICI", "Super Admin"),
    ("wingadmin", "wing123", Role.wing_admin, "ICI", "I&CI Wing Admin"),
    ("officer1", "officer123", Role.officer, "ICI", "Officer One (I&CI)"),
    ("officer2", "officer123", Role.officer, "INV", "Officer Two (Investigation)"),
    ("auditor1", "auditor123", Role.auditor, "INV", "Auditor One"),
]
WINGS = [
    # name, code, seat_limit
    ("IT I&CI", "ICI", 5),
    ("IT Investigation", "INV", 10),
]


def run() -> None:
    configure_logging()
    db = SessionLocal()
    try:
        dept = db.scalar(select(Department).where(Department.name == "Income Tax Department"))
        if not dept:
            dept = Department(name="Income Tax Department")
            db.add(dept)
            db.flush()

        wings: dict[str, Wing] = {}
        for name, code, seats in WINGS:
            wing = db.scalar(select(Wing).where(Wing.code == code))
            if not wing:
                wing = Wing(department_id=dept.id, name=name, code=code, seat_limit=seats)
                db.add(wing)
                db.flush()
            wings[code] = wing

        for username, password, role, wing_code, full_name in DEMO:
            if db.scalar(select(User).where(User.username == username)):
                continue
            db.add(User(
                username=username, password_hash=hash_password(password), role=role,
                full_name=full_name, wing_id=wings[wing_code].id,
            ))
        db.commit()
        log.info("seed complete. wings=%s users=%d", list(wings), len(DEMO))
        print("Seeded. Try logging in as officer1 / officer123 (wing IT I&CI, 5 seats).")
    finally:
        db.close()


if __name__ == "__main__":
    run()
