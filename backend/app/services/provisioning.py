"""Auto-provisioning for new users: a free-trial subscription (100K tokens) plus
a license key they activate by pasting it in.

Called from both self-service signup (`auth.register`) and admin user creation
(`admin.create_user`) so every new account lands ready-to-use: approved, with a
trial token allowance and a license key to claim.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin import LicenseKey
from app.models.billing import SubscriptionPlan, UserSubscription

TRIAL_TOKENS = 100_000
TRIAL_DAYS = 30
TRIAL_PLAN_NAME = "Free Trial"
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _gen_key() -> str:
    """BHTX-XXXX-XXXX-XXXX-XXXX (Crockford-ish alphabet, no ambiguous chars)."""
    chunks = ["".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(4)]
    return "BHTX-" + "-".join(chunks)


def get_or_create_trial_plan(db: Session) -> SubscriptionPlan:
    plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.name == TRIAL_PLAN_NAME))
    if plan is None:
        plan = SubscriptionPlan(
            name=TRIAL_PLAN_NAME,
            description="Auto-granted free trial on signup — 100,000 tokens.",
            monthly_price_inr=0,
            monthly_token_allowance=TRIAL_TOKENS,
            is_active=True,
            sort_order=0,
        )
        db.add(plan)
        db.flush()
    return plan


def provision_trial(db: Session, user, *, admin_id: int | None = None) -> str | None:
    """Grant `user` a free-trial subscription and mint a license key for them.

    - Skips the subscription if the user already has an active one.
    - The license key is created UNASSIGNED so the user activates it by pasting
      it (auth.license_activate claims the first unassigned key for them).

    Returns the license-key string (or None if key generation failed). The
    caller is responsible for committing.
    """
    now = datetime.now(timezone.utc)

    # 1) Trial subscription (only if the user has no active subscription).
    has_active = db.scalar(
        select(UserSubscription).where(
            UserSubscription.user_id == user.id,
            UserSubscription.status == "active",
        )
    )
    if has_active is None:
        plan = get_or_create_trial_plan(db)
        db.add(
            UserSubscription(
                user_id=user.id,
                plan_id=plan.id,
                status="active",
                is_free_trial=True,
                tokens_allowed_override=TRIAL_TOKENS,
                expires_at=now + timedelta(days=TRIAL_DAYS),
                granted_by_admin_id=admin_id,
                notes="Auto-granted free trial (100,000 tokens).",
            )
        )

    # 2) License key. Assigned to the user on creation so they can start
    #    using the app immediately -- users no longer paste a key to
    #    activate. If an admin later flips the license to `deactivated`,
    #    the session-status probe forces sign-out on the desktop and web.
    candidate = None
    for _ in range(6):
        c = _gen_key()
        if not db.scalar(select(LicenseKey).where(LicenseKey.key == c)):
            candidate = c
            break
    if candidate is None:
        return None
    db.add(
        LicenseKey(
            key=candidate,
            status="active",
            valid_until=now + timedelta(days=TRIAL_DAYS),
            assigned_to=user.username,
            created_by_user_id=admin_id,
            notes=f"Trial license for {user.username}",
        )
    )
    db.flush()
    return candidate
