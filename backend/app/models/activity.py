"""Query history and the audit log. Every query and document access is logged
(user, wing, timestamp, query) — a hard requirement."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.models.enums import QueryScope


class Query(Base):
    __tablename__ = "queries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    wing_id: Mapped[int] = mapped_column(ForeignKey("wings.id"), index=True)
    scope: Mapped[QueryScope] = mapped_column(default=QueryScope.corpus)
    domain: Mapped[str | None] = mapped_column(String(50), nullable=True)   # module filter
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations: Mapped[list] = mapped_column(JSONB, default=list)            # [{chunk_id, breadcrumb, url}]
    retrieval_meta: Mapped[dict] = mapped_column(JSONB, default=dict)       # scores, k, grounded?
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    wing_id: Mapped[int | None] = mapped_column(ForeignKey("wings.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)            # login, ask, doc_upload, doc_access
    resource_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    query_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
