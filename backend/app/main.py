"""TaxMedha API entrypoint."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin, ask, auth, documents, history
from app.core.config import settings
from app.core.logging import configure_logging

configure_logging()

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


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "app": settings.app_name, "llm_backend": settings.llm_backend}
