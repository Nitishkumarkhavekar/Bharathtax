"""Assessment-order drafting — the AO-side parallel of the appeals engine.

A case, its uploaded documents (return, notices, replies, third-party info),
pipeline runs, and the issue-wise outputs. Mirrors app.models.appeal so the
same Celery orchestration, DOCX export and polling frontend can be reused.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

# case status: new | running | ready | error
# run status:  queued | running | done | error
# output kind: understanding | issue | computation | order


class AssessmentCase(Base):
    __tablename__ = "assessment_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    owner_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    wing_id: Mapped[int] = mapped_column(ForeignKey("wings.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    assessment_year: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pan: Mapped[str | None] = mapped_column(String(20), nullable=True)
    section: Mapped[str | None] = mapped_column(String(40), nullable=True)   # 143(3) / 147 / 144
    status: Mapped[str] = mapped_column(String(20), default="new")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    documents: Mapped[list["AssessmentDocument"]] = relationship(back_populates="case", cascade="all, delete-orphan")
    runs: Mapped[list["AssessmentRun"]] = relationship(back_populates="case", cascade="all, delete-orphan")


class AssessmentDocument(Base):
    __tablename__ = "assessment_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("assessment_cases.id"), index=True)
    filename: Mapped[str] = mapped_column(String(500))
    category: Mapped[str] = mapped_column(String(50), default="unclassified")
    minio_key: Mapped[str] = mapped_column(String(500))
    text: Mapped[str] = mapped_column(Text, default="")
    pages: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    digest: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    case: Mapped[AssessmentCase] = relationship(back_populates="documents")


class AssessmentRun(Base):
    __tablename__ = "assessment_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("assessment_cases.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")
    progress: Mapped[str | None] = mapped_column(String(200), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    case: Mapped[AssessmentCase] = relationship(back_populates="runs")
    outputs: Mapped[list["AssessmentOutput"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class AssessmentOutput(Base):
    __tablename__ = "assessment_outputs"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("assessment_runs.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40))          # understanding | issue | computation | order
    seq: Mapped[int] = mapped_column(Integer, default=0)   # issue index for kind=issue
    label: Mapped[str | None] = mapped_column(String(300), nullable=True)
    content: Mapped[str] = mapped_column(Text, default="")
    citations: Mapped[list] = mapped_column(JSONB, default=list)
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    docx_blob: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    run: Mapped[AssessmentRun] = relationship(back_populates="outputs")
