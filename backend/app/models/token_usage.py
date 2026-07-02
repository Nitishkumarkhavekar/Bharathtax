"""Per-request LLM token accounting.

Every call the app makes to the model gateway is written here with the
prompt / completion split so we can bill, throttle, or just show users what
they've spent. Kept intentionally small — no soft-delete, no versioning, one
row per LLM call.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class TokenUsage(Base):
    __tablename__ = "token_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    # `user_id` is nullable so that background pipelines that don't have a
    # user (e.g. nightly ingestion) can still log — but every user-triggered
    # call has it set.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(60), index=True)
    # Full model identifier as sent to the gateway (e.g. "bharattax-rag",
    # "llama-3.1-8b-instruct").
    model: Mapped[str] = mapped_column(String(120))
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
