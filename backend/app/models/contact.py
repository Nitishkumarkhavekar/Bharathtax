"""Public contact-form submissions (from the marketing site, logged-out
visitors). Distinct from the in-app SupportTicket flow, which is for
authenticated users."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ContactMessage(Base):
    __tablename__ = "contact_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(255), index=True)
    # Mobile is optional in schema (older rows have NULL) but the marketing
    # form asks for it — the admin Leads table sorts leads by created_at DESC
    # and mobile is a key channel back to the lead.
    mobile: Mapped[str | None] = mapped_column(String(32), nullable=True)
    organisation: Mapped[str | None] = mapped_column(String(200), nullable=True)
    topic: Mapped[str | None] = mapped_column(String(60), nullable=True)
    message: Mapped[str] = mapped_column(Text)
    handled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
