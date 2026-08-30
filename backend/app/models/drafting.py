"""Officer-side drafting: notices, orders and letters generated grounded in the
primary-law corpus, from the Department's standpoint. Distinct from the appeal
module (full CIT(A)/NFAC orders, on the secure desktop app) — this is the
day-to-day drafting suite for the web app.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DraftDocument(Base):
    __tablename__ = "draft_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    wing_id: Mapped[int | None] = mapped_column(ForeignKey("wings.id"), nullable=True, index=True)
    # Template key, e.g. "notice_142_1" (see services.drafting.TEMPLATES).
    kind: Mapped[str] = mapped_column(String(40), index=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    # The form inputs the draft was generated from (assessee, PAN, AY, facts…).
    inputs: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), default=dict)
    # The generated / officer-edited draft text (markdown).
    content: Mapped[str] = mapped_column(Text, default="")
    # draft | in_review | approved | returned | final. The review states drive the
    # senior-approval workflow (a junior sends a draft up to a senior for sanction,
    # mirroring §151 / §153D approval).
    status: Mapped[str] = mapped_column(String(16), default="draft")
    # The senior currently (or last) asked to review this draft. NULL until it is
    # first sent for review. Denormalised here for a cheap owner-OR-reviewer access
    # gate; the per-cycle history lives in draft_reviews.
    reviewer_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
