"""BharathTax API entrypoint."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, appeal, assist, ask, auth, documents, history, rulings
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


_ensure_admin_tables()

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
app.include_router(rulings.router)
app.include_router(assist.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "llm_backend": settings.llm_backend}
