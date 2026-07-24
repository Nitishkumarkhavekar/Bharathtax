"""Support / Report-Issue conversations between officers and admins.

An officer opens a `SupportTicket` from the desktop app when they hit a
problem.  Each ticket is a conversation of `SupportMessage`s — the officer
sends the first one, an admin replies through the web admin panel, and it
alternates until the ticket is closed.  Notifications are polled from the
client side; no push channel yet.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    officer_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    subject: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # open|closed
    # Snapshot of the officer's client at open time so the admin can tell
    # which app version was in use.  Kept optional.
    client_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Bumped whenever a new message lands so we can build a stable "unread
    # since <last_read_at>" query without touching every row.
    last_message_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    officer_last_read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    admin_last_read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    messages: Mapped[list["SupportMessage"]] = relationship(
        back_populates="ticket", cascade="all, delete-orphan",
        order_by="SupportMessage.id",
    )


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(
        ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True
    )
    sender_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # "officer" | "admin" — recorded on write so we don't have to re-query
    # roles when rendering.  Also lets us surface admin messages even if the
    # admin later loses the role.
    sender_role: Mapped[str] = mapped_column(String(16))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    ticket: Mapped[SupportTicket] = relationship(back_populates="messages")
    attachments: Mapped[list["SupportAttachment"]] = relationship(
        back_populates="message", cascade="all, delete-orphan",
        order_by="SupportAttachment.id",
    )


class SupportAttachment(Base):
    """Screenshot / image attachment on a support message.

    The bytes live in R2 at `support/<ticket_id>/<message_id>/<safe_filename>`.
    We store the key + metadata here so both officer and admin sides can
    render thumbnails and stream the file back through the API without ever
    handing R2 credentials to the browser.
    """
    __tablename__ = "support_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(
        ForeignKey("support_messages.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(300))
    mime_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column()
    r2_key: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    message: Mapped[SupportMessage] = relationship(back_populates="attachments")
