"""Draft review & approval — the senior-sanction workflow.

A junior officer (TA / MTS / Inspector / ITO) drafts a notice or order and sends
it UP to a senior of their choosing for review. The senior may edit it inline and
then Approve or Return-with-remarks. This digitises the department's real approval
chain (e.g. §151 sanction for reopening, §153D approval for search assessments).

One `DraftReview` row per review CYCLE (send → resolve), so the full history of a
draft's approvals is auditable. The draft's current state + current reviewer live
denormalised on `DraftDocument` for the access gate.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DraftReview(Base):
    __tablename__ = "draft_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(
        ForeignKey("draft_documents.id", ondelete="CASCADE"), index=True)
    drafter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reviewer_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # pending (awaiting the reviewer) | approved | returned
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    # The drafter's covering note when sending, and the reviewer's remarks on resolve.
    request_note: Mapped[str] = mapped_column(Text, default="")
    review_remarks: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_draft_reviews_reviewer_status", "reviewer_user_id", "status"),
    )
