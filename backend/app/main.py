"""BharathTax API entrypoint."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, appeal, assist, ask, auth, documents, history, rulings
from app.api.routes import appeal_oo
from app.core.config import settings
from app.core.db import Base, engine
from app.core.logging import configure_logging, get_logger

import app.models  # noqa: F401  ensure all models are registered on Base.metadata

configure_logging()
_log = get_logger(__name__)


def _ensure_admin_tables() -> None:
    """Create net-new admin tables (license_keys, revenue_entries) if missing.

    The original Alembic chain is sealed and we layer post-baseline tables in
    via SQLAlchemy's checkfirst=True semantics so we don't re-create the
    full schema on every boot.
    """
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
    except Exception as exc:        # pragma: no cover - boot diagnostic only
        _log.warning("create_all failed (continuing): %s", exc)


def _patch_user_columns() -> None:
    """Add the self-service-registration columns to `users` if a previous
    schema is in place. Idempotent — uses ADD COLUMN IF NOT EXISTS.
    """
    from sqlalchemy import text
    stmts = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(20) NOT NULL DEFAULT 'approved'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by_user_id INTEGER",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation VARCHAR(200)",
        # Persist the OnlyOffice-edited .docx so re-opening the editor doesn't
        # lose the user's formatting (re-rendering from markdown would strip
        # in-editor tables, font changes, etc.).
        "ALTER TABLE appeal_outputs ADD COLUMN IF NOT EXISTS docx_blob BYTEA",
        # Celery task id per run so /appeal/runs/{id}/cancel can revoke it.
        "ALTER TABLE appeal_runs ADD COLUMN IF NOT EXISTS task_id VARCHAR(64)",
        # Backfill email for old seeded users so they can log in by email.
        "UPDATE users SET email = lower(username) || '@bharathtax.com' WHERE email IS NULL",
        # Migrate any previously-seeded @bharathtax.local addresses to the new
        # @bharathtax.com domain.
        "UPDATE users SET email = replace(lower(email), '@bharathtax.local', '@bharathtax.com') WHERE lower(email) LIKE '%@bharathtax.local'",
        # Unique index on lower(email) so user@x.com == User@X.com.
        "CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq ON users (lower(email))",
    ]
    try:
        with engine.begin() as conn:
            for s in stmts:
                conn.execute(text(s))
    except Exception as exc:        # pragma: no cover - boot diagnostic only
        _log.warning("user-column patch failed (continuing): %s", exc)


_ensure_admin_tables()
_patch_user_columns()

app = FastAPI(title=settings.app_name, version="0.1.0")

# Dev CORS: the Vite frontend. Tighten via config for production deployments.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(ask.router)
app.include_router(documents.router)
app.include_router(history.router)
app.include_router(admin.router)
app.include_router(appeal.router)
app.include_router(appeal_oo.router)
app.include_router(rulings.router)
app.include_router(assist.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "llm_backend": settings.llm_backend}
