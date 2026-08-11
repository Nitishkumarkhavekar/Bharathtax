"""BharatTax API entrypoint."""
from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import require_feature
from app.api.routes import admin, appeal, assist, ask, auth, billing, chats, documents, history, ratings, rulings
from app.api.routes import appeal_oo, crossref, desktop_update, desktop_admin, personalization, drafting, contact
from app.api.routes import support as support_routes
from app.api.routes import desktop_session as ds_routes
from app.api.routes import password_reset as pw_reset_routes
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
        # Personalization: officer's charge/posting + preferred UI language.
        # The Alembic chain that adds these (f7b2c4d9e310) can't run on prod —
        # its recorded revision has drifted off the versioned chain — so we add
        # them here, idempotently, the same way as the columns above.
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS charge VARCHAR(200)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(10) NOT NULL DEFAULT 'en'",
        # Pin a chat to the top of the sidebar. Same idempotent boot-patch route.
        "ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE",
        # Internal read-only share link token.
        "ALTER TABLE chats ADD COLUMN IF NOT EXISTS share_id VARCHAR(36)",
        "CREATE UNIQUE INDEX IF NOT EXISTS chats_share_id_uq ON chats (share_id)",
        # Persist the OnlyOffice-edited .docx so re-opening the editor doesn't
        # lose the user's formatting (re-rendering from markdown would strip
        # in-editor tables, font changes, etc.).
        "ALTER TABLE appeal_outputs ADD COLUMN IF NOT EXISTS docx_blob BYTEA",
        # Celery task id per run so /appeal/runs/{id}/cancel can revoke it.
        "ALTER TABLE appeal_runs ADD COLUMN IF NOT EXISTS task_id VARCHAR(64)",
        # SHA-256 dedup on uploaded appeal PDFs so we skip Gemini OCR when
        # the same PDF has already been extracted (across ANY case in the
        # department). Biggest single Gemini-cost lever.
        "ALTER TABLE appeal_documents ADD COLUMN IF NOT EXISTS sha256 VARCHAR(64)",
        "CREATE INDEX IF NOT EXISTS appeal_documents_sha256_idx ON appeal_documents (sha256)",
        # Opaque public slug on appeal_cases — hides the sequential id from
        # URLs. Backfill uses gen_random_uuid(); requires pgcrypto (loaded
        # into postgres by default in the current image).
        "CREATE EXTENSION IF NOT EXISTS pgcrypto",
        "ALTER TABLE appeal_cases ADD COLUMN IF NOT EXISTS slug VARCHAR(36)",
        "UPDATE appeal_cases SET slug = replace(gen_random_uuid()::text, '-', '') WHERE slug IS NULL",
        "ALTER TABLE appeal_cases ALTER COLUMN slug SET NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS appeal_cases_slug_uq ON appeal_cases (slug)",
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


# Fail fast if we're in production with default secrets or a wildcard CORS.
settings.assert_prod_safe()

_ensure_admin_tables()
_patch_user_columns()

app = FastAPI(title=settings.app_name, version="0.1.0")

# CORS origins come from config (CORS_ALLOWED_ORIGINS); "*" only in dev.
# allow_credentials must be False when origins is "*" (browsers reject the combo).
_origins = settings.allowed_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
# Per-user module gating: a non-admin without the feature gets 403 on the whole
# router (belt-and-braces with the sidebar hiding it). Admins bypass.
app.include_router(ask.router, dependencies=[Depends(require_feature("chat"))])
app.include_router(chats.router, dependencies=[Depends(require_feature("chat"))])
app.include_router(documents.router, dependencies=[Depends(require_feature("documents"))])
app.include_router(history.router, dependencies=[Depends(require_feature("history"))])
app.include_router(admin.router)
app.include_router(appeal.router, dependencies=[Depends(require_feature("appeals"))])
app.include_router(appeal_oo.router, dependencies=[Depends(require_feature("appeals"))])
app.include_router(rulings.router, dependencies=[Depends(require_feature("rulings"))])
app.include_router(crossref.router, dependencies=[Depends(require_feature("rulings"))])
app.include_router(assist.router)
app.include_router(ratings.router)
app.include_router(billing.router)
app.include_router(personalization.router)
# Officer drafting suite (notices/orders). Authenticated; a dedicated "drafting"
# entitlement can be added to require_feature later.
app.include_router(drafting.router)
app.include_router(contact.router)
# Auto-update feed for the packaged desktop app. Unauthenticated on purpose —
# electron-updater cannot carry a JWT and the artefacts already live behind
# a signed URL layer with a whitelist by suffix.
app.include_router(desktop_update.router)
# Public listing (used by the landing-page /releases section).
app.include_router(desktop_update.public_router)
# Admin CRUD for uploading / publishing / deleting desktop releases.
app.include_router(desktop_admin.router)
# Support (Report Issue) — officer + admin sides.
app.include_router(support_routes.router)
app.include_router(support_routes.admin_router)
# Desktop-session tracking + admin log listing.
app.include_router(ds_routes.router)
app.include_router(ds_routes.admin_router)
# Public password-reset flow.
app.include_router(pw_reset_routes.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "llm_backend": settings.llm_backend}
