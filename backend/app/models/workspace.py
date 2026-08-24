"""Daily-workspace models: matters (docket), statutory deadlines, reminders.

The personalization / productivity layer that turns BharatTax from a Q&A tool
into a daily workspace. A *matter* is a case the user is working (by PAN / AY /
appeal no.); *deadlines* are statutory dates computed from a trigger event via
:mod:`app.services.limitation` (or entered manually); *reminders* are the nudges.

Everything is per-user scoped and user-deletable — the same government-tool
requirement that governs :mod:`app.models.personalization`.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Matter(Base):
    """A case the user is working — the anchor everything else attaches to."""
    __tablename__ = "matters"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    pan: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    assessment_year: Mapped[str | None] = mapped_column(String(9), nullable=True)   # "2023-24"
    appeal_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # Wing/role context: officer / cita / drp / investigation / ici / tds / ca …
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # open | in_progress | awaiting_order | closed
    status: Mapped[str] = mapped_column(String(20), default="open", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Deadline(Base):
    """A statutory (auto-computed) or manual deadline attached to a matter."""
    __tablename__ = "deadlines"

    id: Mapped[int] = mapped_column(primary_key=True)
    matter_id: Mapped[int] = mapped_column(
        ForeignKey("matters.id", ondelete="CASCADE"), index=True
    )
    # Denormalised for cheap per-user calendar queries (avoids a join to matters).
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # The limitation rule id that produced it (e.g. "appeal_cita") or "manual".
    kind: Mapped[str] = mapped_column(String(40), default="manual")
    label: Mapped[str] = mapped_column(String(160))
    section_ref: Mapped[str | None] = mapped_column(String(40), nullable=True)   # "Sec. 249"
    # What the user entered to derive it, kept so the date can be recomputed.
    trigger_event: Mapped[str | None] = mapped_column(String(40), nullable=True)
    trigger_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date] = mapped_column(Date, index=True)
    is_auto: Mapped[bool] = mapped_column(Boolean, default=True)
    # open | done | dismissed
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Reminder(Base):
    """A dated nudge — optionally tied to a matter and/or a deadline."""
    __tablename__ = "reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    matter_id: Mapped[int | None] = mapped_column(
        ForeignKey("matters.id", ondelete="CASCADE"), nullable=True, index=True
    )
    deadline_id: Mapped[int | None] = mapped_column(
        ForeignKey("deadlines.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200))
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    # Delivery channels, e.g. ["in_app", "email"].
    channels: Mapped[list] = mapped_column(JSONB, default=list)
    # pending | sent | done | dismissed
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class StickyNote(Base):
    """A colour-coded note pinned to a matter (and optionally a section or a
    source such as a chat answer or uploaded document)."""
    __tablename__ = "sticky_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    matter_id: Mapped[int | None] = mapped_column(
        ForeignKey("matters.id", ondelete="CASCADE"), nullable=True, index=True
    )
    body: Mapped[str] = mapped_column(Text)
    # Sticky colour key: yellow | blue | green | pink | slate.
    color: Mapped[str] = mapped_column(String(16), default="yellow")
    section_ref: Mapped[str | None] = mapped_column(String(40), nullable=True)   # "Sec. 68"
    # Free-form provenance, e.g. "chat:123", "doc:45", or a citation string.
    source: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WorkspaceTemplate(Base):
    """A user's reusable drafting template (notice / order / appeal boilerplate)
    with {{PAN}} / {{AY}} / {{ASSESSEE}} placeholders filled from a matter."""
    __tablename__ = "workspace_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(32), default="other")   # notice/order/appeal/other
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Watchlist(Base):
    """A saved watch — a section, topic or assessee to track for new rulings."""
    __tablename__ = "watchlists"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    label: Mapped[str] = mapped_column(String(120))
    query: Mapped[str] = mapped_column(String(300))          # search terms
    kind: Mapped[str] = mapped_column(String(16), default="topic")   # section/topic/assessee
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class MatterShare(Base):
    """Shares a matter with another user (view-only in v1) — the collaboration
    primitive for ranges / circles / firms."""
    __tablename__ = "matter_shares"

    id: Mapped[int] = mapped_column(primary_key=True)
    matter_id: Mapped[int] = mapped_column(
        ForeignKey("matters.id", ondelete="CASCADE"), index=True
    )
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    shared_with_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    permission: Mapped[str] = mapped_column(String(8), default="view")   # view | edit
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
