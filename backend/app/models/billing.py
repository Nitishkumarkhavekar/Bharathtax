"""Billing & subscription models.

Three tables:
  * `subscription_plans` — the SKUs an admin defines (Free Trial, Basic, Pro,
    etc.).  Each has a monthly INR price and a monthly token allowance.
  * `user_subscriptions` — assigns ONE plan to a user for a fixed window.
    Only one is `status='active'` at a time.  Older ones are kept for history.
  * `token_prices` — per-1,000-token unit price per model, in INR.  Powers
    the admin's "cost per query" view and the officer's spend breakdown.

`tokens_used` is deliberately NOT stored on `user_subscriptions` — we compute
it on demand from `token_usage` (the source of truth) filtered by the
subscription window.  Avoids drift and race conditions.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SubscriptionPlan(Base):
    """A named tier the admin sells to users. Free Trial / Basic / Pro / …"""
    __tablename__ = "subscription_plans"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)          # e.g. "Basic"
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    monthly_price_inr: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    monthly_token_allowance: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Presentation order for the pricing page. 0 = first.
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UserSubscription(Base):
    """Assigns a plan to a user for a fixed window."""
    __tablename__ = "user_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("subscription_plans.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Nullable: an `expires_at IS NULL` sub is open-ended (admin manually
    # extends / cancels).  Most subs are 30 days.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Override the plan's allowance for THIS particular user's subscription
    # (e.g. grant a bonus).  Nullable = inherit from the plan.
    tokens_allowed_override: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_free_trial: Mapped[bool] = mapped_column(Boolean, default=False)
    granted_by_admin_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # active | expired | cancelled — admin-controlled state machine.
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TokenPrice(Base):
    """Per-1,000-token unit price in INR for a given model.

    Only ONE row per `model_slug` is `is_active=True` at any time. When the
    admin sets a new price, we mark the previous row inactive so historical
    invoices still know what price applied at the time.
    """
    __tablename__ = "token_prices"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The `model` string as it appears in `token_usage.model` — e.g.
    # "gemini-2.5-flash", "bharattax-rag", "llama-3.1-8b-instruct".
    model_slug: Mapped[str] = mapped_column(String(120), index=True)
    provider: Mapped[str | None] = mapped_column(String(40), nullable=True)   # "gemini" / "openai" / "internal"
    input_price_per_1k_inr: Mapped[float] = mapped_column(Numeric(12, 4), default=0)
    output_price_per_1k_inr: Mapped[float] = mapped_column(Numeric(12, 4), default=0)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
