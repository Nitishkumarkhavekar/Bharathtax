"""Pytest fixtures for DB-backed integration tests.

Uses an in-memory SQLite database with only the tables the workspace service
touches (plus a minimal ``users`` table). The models are dialect-agnostic
(JSONB→JSON, ARRAY→JSON on SQLite via ``with_variant``), so the access-control
logic can be tested without a Postgres server. This is a faithful test of the
query/ownership logic — not of Postgres-specific behaviour (e.g. ON DELETE
CASCADE, which SQLite doesn't enforce by default).
"""
import os

# Keep the app's (lazy, unused) engine import happy without a real DB.
os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/test")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import Base
import app.models  # noqa: F401 — register every model on Base.metadata
from app.models.org import User
from app.models.workspace import (
    Deadline, Demand, Matter, MatterShare, Reminder, StickyNote, Watchlist, WorkspaceTemplate,
)

_TABLES = [
    User.__table__, Matter.__table__, Deadline.__table__, Reminder.__table__,
    StickyNote.__table__, WorkspaceTemplate.__table__, Watchlist.__table__,
    MatterShare.__table__, Demand.__table__,
]


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=_TABLES)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def user_factory(db):
    """Insert a user row (share_matter/list_shares resolve id ↔ email/name)."""
    def make(uid: int, email: str | None = None, full_name: str | None = None) -> User:
        u = User(id=uid, username=f"user{uid}", email=email, full_name=full_name,
                 password_hash="x", wing_id=1)
        db.add(u)
        db.commit()
        return u
    return make
