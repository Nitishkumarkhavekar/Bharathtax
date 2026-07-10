"""Appeal-order drafting: a case, its uploaded documents, pipeline runs and the
issue-wise outputs. Grounding/citations reuse the corpus retrieval; these tables
hold the case-specific workflow state (BharathTax's "Draft Bot")."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

# case status: new | running | ready | error
# run status:  queued | running | done | error
# output kind: compliance | deficiency | scope | issue_matrix | finding | draft | citation_audit


class AppealCase(Base):
    __tablename__ = "appeal_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Public opaque identifier — appears in URLs instead of `id` so that the
    # sequential integer id (an implementation detail + enumeration vector) is
    # never exposed to users. UUID4 as a hex string, 32 chars, dashless. Every
    # externally-callable route accepts EITHER slug or numeric id; the numeric
    # id path is kept for admin/internal tooling. See _get_case().
    slug: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    owner_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    wing_id: Mapped[int] = mapped_column(ForeignKey("wings.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    assessment_year: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pan: Mapped[str | None] = mapped_column(String(20), nullable=True)
    section: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    documents: Mapped[list["AppealDocument"]] = relationship(back_populates="case", cascade="all, delete-orphan")
    runs: Mapped[list["AppealRun"]] = relationship(back_populates="case", cascade="all, delete-orphan")


class AppealDocument(Base):
    __tablename__ = "appeal_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("appeal_cases.id"), index=True)
    filename: Mapped[str] = mapped_column(String(500))
    category: Mapped[str] = mapped_column(String(50), default="unclassified")
    minio_key: Mapped[str] = mapped_column(String(500))
    text: Mapped[str] = mapped_column(Text, default="")
    pages: Mapped[int] = mapped_column(Integer, default=0)
    # SHA-256 hex of the raw PDF bytes. Populated on upload. Used as the
    # dedup key — if another AppealDocument already has this sha256 AND
    # non-empty text, we copy its `text` instead of re-running Gemini OCR.
    # Nullable so historic rows uploaded before this migration keep working
    # (they simply skip the dedup path).
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    case: Mapped[AppealCase] = relationship(back_populates="documents")


class AppealRun(Base):
    __tablename__ = "appeal_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("appeal_cases.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    progress: Mapped[str | None] = mapped_column(String(200), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Celery task id so we can revoke a running pipeline on user cancel.
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    case: Mapped[AppealCase] = relationship(back_populates="runs")
    outputs: Mapped[list["AppealOutput"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class AppealOutput(Base):
    __tablename__ = "appeal_outputs"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("appeal_runs.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    seq: Mapped[int] = mapped_column(Integer, default=0)          # issue index for kind=finding
    label: Mapped[str | None] = mapped_column(String(300), nullable=True)
    content: Mapped[str] = mapped_column(Text, default="")
    citations: Mapped[list] = mapped_column(JSONB, default=list)
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)      # higher = newer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # When the user edits the draft in OnlyOffice we persist the binary docx
    # here so subsequent edit sessions load *their* document, not a freshly
    # re-rendered one from `content` (which would lose formatting).
    docx_blob: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    run: Mapped[AppealRun] = relationship(back_populates="outputs")
