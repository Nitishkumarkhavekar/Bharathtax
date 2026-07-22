"""Desktop-app release catalogue.

Each row is one shipped version of the Electron desktop app.  The `is_current`
row is what `GET /desktop/update/latest.yml` advertises to installed clients —
electron-updater on the officer's laptop polls that feed, compares versions,
and downloads the new .exe if needed.

Only one release per channel can be `is_current=True` at a time; publishing a
new one supersedes the old one atomically inside the admin route.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DesktopRelease(Base):
    __tablename__ = "desktop_releases"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Semantic version.  electron-updater compares these lexically per semver
    # rules, so keep them zero-padded ("1.0.10" > "1.0.9") is NOT true here —
    # semver ordering is used, which handles that correctly.
    version: Mapped[str] = mapped_column(String(40), unique=True, index=True)

    # Update channel.  The desktop app's `publish` config subscribes to one
    # channel ("latest" by default).  Beta / rc channels can be added later.
    channel: Mapped[str] = mapped_column(String(20), default="latest", index=True)

    # Release notes — free-form markdown, shown in the admin table and (later)
    # in the desktop app's "What's new" popup.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # R2 keys for the artefacts.  We store the KEY (not a signed URL) because
    # the key is stable — the signed URL is re-minted per request downstream.
    installer_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    portable_key: Mapped[str | None]  = mapped_column(String(300), nullable=True)
    blockmap_key: Mapped[str | None]  = mapped_column(String(300), nullable=True)

    # Sizes and hashes.  `installer_sha512` is what electron-updater checks
    # against the downloaded file to detect tampering, so we MUST compute it
    # server-side when the upload lands.
    installer_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    portable_size: Mapped[int | None]  = mapped_column(BigInteger, nullable=True)
    installer_sha512: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Exactly one row per channel is "current"; that one is what latest.yml
    # advertises. Others are kept for rollback and history.
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    # Housekeeping.
    uploaded_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
