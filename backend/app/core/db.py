"""Database engine, session factory, and declarative Base."""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

from app.core.config import settings

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    # Sized for the threads-pool Celery worker: up to 12 concurrent tasks,
    # each of which may spawn up to 6 issue-drafting threads (each opens
    # its own SessionLocal). We keep an overflow so a burst of parallel
    # /run submissions from officers doesn't starve on pool_size alone.
    pool_size=20,
    max_overflow=30,
    # Kill idle connections after 30 minutes so we don't hoard postgres
    # slots across a quiet weekend.
    pool_recycle=1800,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
