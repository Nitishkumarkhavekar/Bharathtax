"""Latest-news feed.

Each row is one article surfaced from an external tax-news source (Google
Alerts Atom, PIB RSS, publisher RSS). Deduplicated by content-hash so we
never show the same story twice even when several sources cover it.

Source config (URL, poll interval, active flag) lives in `NewsSource`; the
Celery beat task `poll_news_feeds` reads active rows and inserts new items.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class NewsSource(Base):
    """A configured feed (RSS / Atom / JSON). Admin-managed."""

    __tablename__ = "news_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    # atom | rss | google_alert | pib
    kind: Mapped[str] = mapped_column(String(24), default="atom")
    url: Mapped[str] = mapped_column(String(1000))
    # Free-form label to filter/group in the UI (e.g. "General", "CBDT",
    # "Case law", "GST"). Kept short so the frontend filter chips stay tidy.
    category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    poll_interval_minutes: Mapped[int] = mapped_column(Integer, default=30)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    # Set by the poller — the last time we successfully fetched from this
    # source (regardless of whether new items were found). Used by the admin
    # UI to spot silently-broken feeds.
    last_polled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class NewsItem(Base):
    """One article/story fetched from a `NewsSource`."""

    __tablename__ = "news_items"
    __table_args__ = (
        # A hash-based dedup index — polling the same feed every 30 min must
        # never insert the same story twice.
        Index("ix_news_items_hash_uniq", "hash", unique=True),
        # The feed page is always ordered by published_at DESC — this index
        # keeps that cheap even with 100k+ rows.
        Index("ix_news_items_published_at_desc", "published_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int | None] = mapped_column(
        ForeignKey("news_sources.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    # Denormalised so a card can show "via TaxGuru" without a JOIN and so a
    # source can be deleted without losing its history.
    source_name: Mapped[str] = mapped_column(String(120))
    source_category: Mapped[str | None] = mapped_column(String(40), nullable=True)
    title: Mapped[str] = mapped_column(String(500))
    url: Mapped[str] = mapped_column(String(1000))
    # A 2-3 sentence snippet from the feed. Stripped of HTML.
    snippet: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Publisher's OpenGraph image (from <meta property="og:image">) —
    # populated at ingestion time, best-effort. NULL means we couldn't
    # scrape one; the UI falls back to a category-tinted placeholder.
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # SHA-256 of (normalised_title + '|' + url). The dedup key.
    hash: Mapped[str] = mapped_column(String(64))
    # From the feed's <published>/<updated> when present; otherwise falls back
    # to the fetch time so the feed still sorts sensibly.
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True,
    )
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
