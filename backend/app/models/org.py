"""Org hierarchy + licensing: Department > Wing > Office > User, plus seat leases.

Seat model = CONCURRENT ACTIVE SESSIONS. A wing has `seat_limit` seats; logging
in creates a `SeatLease`; logout/expiry/reaper frees it. Login is blocked when
the count of live leases for the wing reaches `seat_limit`.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.models.enums import Role


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    wings: Mapped[list["Wing"]] = relationship(back_populates="department")


class Wing(Base):
    __tablename__ = "wings"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))
    name: Mapped[str] = mapped_column(String(200))          # e.g. "IT Investigation"
    code: Mapped[str] = mapped_column(String(50), unique=True)
    seat_limit: Mapped[int] = mapped_column(Integer, default=0)   # the seat pool size
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    department: Mapped[Department] = relationship(back_populates="wings")
    offices: Mapped[list["Office"]] = relationship(back_populates="wing")
    users: Mapped[list["User"]] = relationship(back_populates="wing")
    leases: Mapped[list["SeatLease"]] = relationship(back_populates="wing")


class Office(Base):
    __tablename__ = "offices"

    id: Mapped[int] = mapped_column(primary_key=True)
    wing_id: Mapped[int] = mapped_column(ForeignKey("wings.id"))
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(50))

    wing: Mapped[Wing] = relationship(back_populates="offices")
    users: Mapped[list["User"]] = relationship(back_populates="office")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    wing_id: Mapped[int] = mapped_column(ForeignKey("wings.id"))
    office_id: Mapped[int | None] = mapped_column(ForeignKey("offices.id"), nullable=True)
    username: Mapped[str] = mapped_column(String(100), unique=True)
    email: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Free-text organisation the user belongs to (firm / department / company).
    # Filled in by the user from their profile page — independent of `wing`,
    # which is the admin-controlled seat scope.
    organisation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(default=Role.officer)
    # Free-text job title shown across the console (Officer, Auditor, Inspector,
    # CA, Consultant, …). Purely a label — access is governed by `role`
    # (admin vs user) and `features`. NULL falls back to the role name.
    designation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Personalization / drafting profile. `charge` is the officer's posting
    # (e.g. "Ward 28(1), Delhi") — used to personalize answers and pre-fill
    # order/notice headers. Purely descriptive; no access impact.
    charge: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Structured PRIMARY FUNCTION the officer works (officer/cita/drp/tp/
    # investigation/ici/recovery/tds/ca) — drives the role-tailored dashboard
    # and sidebar. Distinct from `role` (access) and `designation` (free-text
    # label). NULL until the user picks one (first-run prompt). Self-set;
    # an admin can override it.
    workspace_profile: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # When workspace_profile == "custom", the set of function keys the user
    # works (union drives their scoped dashboard + featured tools). Ignored for
    # single-function and meta ("all") profiles.
    workspace_wings: Mapped[list[str] | None] = mapped_column(
        ARRAY(String).with_variant(JSON, "sqlite"), nullable=True)
    preferred_language: Mapped[str] = mapped_column(String(10), default="en")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Self-service registrations land as 'pending' and cannot log in until an
    # admin moves them to 'approved'. 'rejected' is terminal.
    approval_status: Mapped[str] = mapped_column(String(20), default="approved")
    approved_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Per-user module access, e.g. ["chat","appeals","rulings","history"].
    # NULL == all modules. Admins are never gated. Set by an admin from the console.
    features: Mapped[list[str] | None] = mapped_column(
        ARRAY(String).with_variant(JSON, "sqlite"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    wing: Mapped[Wing] = relationship(back_populates="users")
    office: Mapped[Office | None] = relationship(back_populates="users")
    leases: Mapped[list["SeatLease"]] = relationship(back_populates="user")


class SeatLease(Base):
    """A live seat held by an active session. `released_at IS NULL AND
    expires_at > now()` == occupying a seat."""
    __tablename__ = "seat_leases"

    id: Mapped[int] = mapped_column(primary_key=True)
    wing_id: Mapped[int] = mapped_column(ForeignKey("wings.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[str] = mapped_column(String(64), unique=True)   # == JWT 'sid'
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    wing: Mapped[Wing] = relationship(back_populates="leases")
    user: Mapped[User] = relationship(back_populates="leases")
