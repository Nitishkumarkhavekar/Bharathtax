"""Per-user subscription quota enforcement.

Every billable action goes through :func:`require_quota` before touching the
model. If the user's active subscription is out of tokens or past expiry the
request is rejected with HTTP 402 and a machine-readable error body so the
frontend can render a clear "you're out of tokens — talk to your admin"
state instead of a raw "Internal Server Error".

Users with **no** subscription attached are allowed through — assignment is
still the admin's responsibility and licensing is enforced elsewhere via
:func:`app.api.deps.require_license`.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.core.enums import Role
from app.models.billing import SubscriptionPlan, UserSubscription
from app.models.org import User
from app.models.token_usage import TokenUsage


def _active_sub(db: Session, user_id: int) -> tuple[UserSubscription | None, SubscriptionPlan | None]:
    sub = db.scalar(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id,
               UserSubscription.status == "active")
        .order_by(desc(UserSubscription.id))
        .limit(1)
    )
    if not sub:
        return None, None
    return sub, db.get(SubscriptionPlan, sub.plan_id)


def check_quota(db: Session, user_id: int) -> None:
    """Raise 402 if the caller's active subscription is expired or exhausted."""
    sub, plan = _active_sub(db, user_id)
    if not sub or not plan:
        # No active plan attached. Admins (who create/manage users and must be
        # able to test the tool) pass through; everyone else is blocked with a
        # clear 402 so an unassigned account cannot consume tokens.
        u = db.get(User, user_id)
        if u is not None and u.role in (Role.super_admin, Role.wing_admin):
            return
        raise HTTPException(
            status_code=402,
            detail={
                "code": "no_plan_assigned",
                "message": (
                    "No active plan is assigned to your account. Please ask your "
                    "administrator to assign a subscription plan before using this tool."
                ),
            },
        )

    now = datetime.now(timezone.utc)
    if sub.expires_at and sub.expires_at < now:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "subscription_expired",
                "message": (
                    f"Your {plan.name} plan expired on "
                    f"{sub.expires_at.date().isoformat()}. "
                    "Please ask your administrator to renew or upgrade."
                ),
                "plan_name": plan.name,
                "expires_at": sub.expires_at.isoformat(),
            },
        )

    allowed = int(sub.tokens_allowed_override or plan.monthly_token_allowance or 0)
    if allowed <= 0:
        # A plan with 0 tokens is treated as "unmetered" (usually only free
        # trials misconfigured this way).  Don't block.
        return

    used = int(db.execute(
        select(func.coalesce(func.sum(TokenUsage.total_tokens), 0))
        .where(TokenUsage.user_id == user_id,
               TokenUsage.created_at >= sub.started_at)
    ).scalar() or 0)

    if used >= allowed:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "quota_exhausted",
                "message": (
                    f"You've used {used:,} of {allowed:,} tokens this period on "
                    f"your {plan.name} plan. Please ask your administrator to "
                    "top up your allowance or upgrade your plan."
                ),
                "plan_name": plan.name,
                "tokens_used": used,
                "tokens_allowed": allowed,
            },
        )


def require_quota(p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> Principal:
    """FastAPI dependency wrapper — attach to every billable endpoint."""
    check_quota(db, p.user.id)
    return p
