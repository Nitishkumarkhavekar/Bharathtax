"""Per-user personalization: settings/custom-instructions + durable global memory.

Distinct from app.models.chat:
  - ChatMemory / ChatSummary  -> memory scoped to ONE conversation (recall within
    a thread, rolling summary).
  - UserMemory (here)         -> durable facts about the user carried across EVERY
    conversation (the ChatGPT-style global "memory"), plus drafting.

Everything is per-user scoped, user-visible and user-deletable — a hard
requirement for a government tool. Personal context is only ever fed to the
self-hosted model, never to the external web-search fallback.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class UserSettings(Base):
    """One row per user. Custom instructions + response-style preferences +
    the master memory on/off switch."""
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # "How should BharatTax answer you?" — free text, injected into the prompt.
    custom_instructions: Mapped[str] = mapped_column(Text, default="")
    # "What should BharatTax know about your work?" — free text.
    about_me: Mapped[str] = mapped_column(Text, default="")
    # Response-style toggles, e.g. {"concise": true, "tables": true,
    # "citation_density": "high", "standpoint": "officer"}.
    # JSONB on Postgres; plain JSON on other dialects (SQLite) so it's testable.
    style: Mapped[dict] = mapped_column(JSON().with_variant(JSONB, "postgresql"), default=dict)
    # Master switch: when False, no learned memory is written or recalled.
    memory_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserMemory(Base):
    """A durable fact about the user, carried across all conversations and into
    drafting. Fully user-managed (view / edit / delete / pin)."""
    __tablename__ = "user_memory"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # fact (stable), matter (an ongoing case), preference (how they like answers).
    kind: Mapped[str] = mapped_column(String(16), default="fact")
    content: Mapped[str] = mapped_column(Text)
    # "manual" (user typed it) or "auto:chat:<id>" (extracted from a conversation).
    source: Mapped[str] = mapped_column(String(48), default="manual")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    # For auto-extracted items — lets the assembler prefer high-confidence facts.
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
