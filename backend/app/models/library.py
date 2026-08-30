"""My Library — an officer's personal collection of saved work.

The switching-cost layer: the more of their own work (grounded answers, case
law, drafts) an officer keeps in BharatTax, the harder it is to go back to a
generic chatbot. Everything here is scoped to one user.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SavedItem(Base):
    __tablename__ = "saved_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # What kind of thing this is: "answer" (a grounded chat answer), "ruling"
    # (a case-law judgment), "draft" (a generated notice/order). Free-form-ish
    # but the API constrains it.
    kind: Mapped[str] = mapped_column(String(16), index=True)
    title: Mapped[str] = mapped_column(String(500), default="")
    # The saved text — answer markdown, ruling headnote, draft body.
    content: Mapped[str] = mapped_column(Text, default="")
    # External link (a ruling's source URL) when there is one.
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # Top-level IT-Act sections this item is about — displayed, and fed back
    # into the ruling-watchlist topic inference (a saved ruling sharpens "for you").
    sections: Mapped[list[str] | None] = mapped_column(
        ARRAY(String).with_variant(JSON, "sqlite"), nullable=True)
    # The id of the thing it was saved FROM (a chat message id, a corpus doc id)
    # so the same source can't be saved twice and the UI can render a saved/unsaved
    # toggle. NULL for items with no natural source (a free note).
    ref_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        # One save per (user, kind, source) — re-saving the same thing is a no-op.
        # ref_id NULL rows are exempt (Postgres allows many NULLs in a unique index).
        UniqueConstraint("user_id", "kind", "ref_id", name="saved_items_user_kind_ref_uq"),
        Index("ix_saved_items_user_created", "user_id", "created_at"),
    )
