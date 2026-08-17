"""Billing & subscription management.

Public surface:
  * /admin/billing/plans           — CRUD subscription plans
  * /admin/billing/token-rates     — CRUD per-1k-token unit prices
  * /admin/billing/users           — list all users with subscription + usage
  * /admin/billing/users/{uid}/assign  — assign a plan (with optional free-trial)
  * /admin/billing/subscriptions/{id}  — patch / cancel a subscription
  * /billing/me                    — logged-in user's own plan + usage + spend
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select, update
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_current_user, get_principal
from app.core.db import get_db
from app.models.billing import SubscriptionPlan, TokenPrice, UserSubscription
from app.models.enums import Role
from app.models.org import User
from app.models.token_usage import TokenUsage

router = APIRouter(tags=["billing"])


# --------------------------------------------------------------------------
# Admin gate
# --------------------------------------------------------------------------
def _admin(user: User = Depends(get_current_user)) -> User:
    if user.role not in (Role.super_admin, Role.wing_admin):
        raise HTTPException(403, "Admin access required")
    return user


# --------------------------------------------------------------------------
# Schemas
# --------------------------------------------------------------------------
class PlanIn(BaseModel):
    name: str
    description: str | None = None
    monthly_price_inr: float = 0
    # Optional explicit yearly override. If null / missing, the API
    # derives it from monthly × 12 × (1 − annual_discount_pct/100).
    yearly_price_inr: float | None = None
    monthly_token_allowance: int = 0
    is_active: bool = True
    sort_order: int = 0
    features: list[str] | None = None
    is_featured: bool = False
    badge: str | None = None
    savings_note: str | None = None
    annual_discount_pct: int = 20


class PlanPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    monthly_price_inr: float | None = None
    yearly_price_inr: float | None = None
    monthly_token_allowance: int | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    features: list[str] | None = None
    is_featured: bool | None = None
    badge: str | None = None
    savings_note: str | None = None
    annual_discount_pct: int | None = None


class TokenRateIn(BaseModel):
    model_slug: str
    provider: str | None = None
    input_price_per_1k_inr: float = 0
    output_price_per_1k_inr: float = 0
    notes: str | None = None


class TokenRatePatch(BaseModel):
    model_slug: str | None = None
    provider: str | None = None
    input_price_per_1k_inr: float | None = None
    output_price_per_1k_inr: float | None = None
    is_active: bool | None = None
    notes: str | None = None


class AssignPlanIn(BaseModel):
    plan_id: int
    is_free_trial: bool = False
    # Days from today. 0 or omitted → open-ended (admin ends it manually).
    duration_days: int | None = Field(default=30, ge=0, le=3650)
    tokens_allowed_override: int | None = None
    notes: str | None = None


class SubscriptionPatch(BaseModel):
    # Admin can edit both endpoints of the subscription window.  Sending
    # `null` for either end explicitly clears it — the schema uses a wrapper
    # value below to distinguish "not sent" from "clear it".
    started_at: datetime | None = None
    expires_at: datetime | None = None
    tokens_allowed_override: int | None = None
    status: str | None = None
    notes: str | None = None
    is_free_trial: bool | None = None


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _plan_out(p: SubscriptionPlan) -> dict:
    monthly = float(p.monthly_price_inr or 0)
    discount_pct = int(getattr(p, "annual_discount_pct", None) or 0)
    # Yearly precedence: explicit yearly_price_inr set by admin wins;
    # otherwise auto-derive from monthly × 12 × (1 − discount_pct/100).
    explicit_yearly = getattr(p, "yearly_price_inr", None)
    if explicit_yearly not in (None, 0):
        yearly = float(explicit_yearly)
    else:
        yearly = round(monthly * 12 * (1 - discount_pct / 100.0)) if monthly > 0 else 0
    return {
        "id": p.id, "name": p.name, "description": p.description,
        "monthly_price_inr": monthly,
        "yearly_price_inr": yearly,
        # Expose whether the yearly is an admin override or an auto-calc,
        # so the UI can show a "custom" indicator next to the field.
        "yearly_price_is_override": explicit_yearly not in (None, 0),
        "annual_discount_pct": discount_pct,
        "monthly_token_allowance": int(p.monthly_token_allowance or 0),
        "is_active": bool(p.is_active),
        "sort_order": int(p.sort_order or 0),
        "features": list(getattr(p, "features", None) or []),
        "is_featured": bool(getattr(p, "is_featured", False)),
        "badge": getattr(p, "badge", None),
        "savings_note": getattr(p, "savings_note", None),
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _rate_out(r: TokenPrice) -> dict:
    return {
        "id": r.id, "model_slug": r.model_slug, "provider": r.provider,
        "input_price_per_1k_inr": float(r.input_price_per_1k_inr or 0),
        "output_price_per_1k_inr": float(r.output_price_per_1k_inr or 0),
        "is_active": bool(r.is_active),
        "effective_from": r.effective_from.isoformat() if r.effective_from else None,
        "notes": r.notes,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


"""Google's Gemini grounded-search fee is charged separately from tokens
(≈ $35 per 1,000 requests, ~₹2.94 per call at ₹84/USD). None of the per-1k
token rate cards capture this — it's paid per invocation. We estimate it
here so admin can see the real cost, worst-case (no free-tier deduction).
"""
_GROUNDING_COST_PER_CALL_INR = 2.94


def _tokens_used_in_window(db: Session, user_id: int,
                           since: datetime | None,
                           until: datetime | None) -> dict:
    """Sum prompt/completion/total tokens for a user's subscription window.

    Also counts `grounded_calls` — Ask-Bot invocations that hit Google's
    grounded web-search (action='ask' + gemini-family model), the driver of
    the per-request grounding fee that per-1k token rates don't capture.
    """
    q = select(
        func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
        func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
        func.coalesce(func.sum(TokenUsage.total_tokens), 0),
        func.count(TokenUsage.id),
    ).where(TokenUsage.user_id == user_id)
    if since:
        q = q.where(TokenUsage.created_at >= since)
    if until:
        q = q.where(TokenUsage.created_at < until)
    pt, ct, tt, calls = db.execute(q).one()

    gq = select(func.count(TokenUsage.id)).where(
        TokenUsage.user_id == user_id,
        TokenUsage.action == "ask",
        TokenUsage.model.ilike("gemini%"),
    )
    if since:
        gq = gq.where(TokenUsage.created_at >= since)
    if until:
        gq = gq.where(TokenUsage.created_at < until)
    grounded_calls = int(db.execute(gq).scalar() or 0)

    return {
        "prompt_tokens": int(pt), "completion_tokens": int(ct),
        "total_tokens": int(tt), "calls": int(calls),
        "grounded_calls": grounded_calls,
        "grounding_cost_est_inr": round(grounded_calls * _GROUNDING_COST_PER_CALL_INR, 2),
    }


def _sub_snapshot(db: Session, sub: UserSubscription | None,
                  plan: SubscriptionPlan | None) -> dict | None:
    """Compact summary of a subscription + live usage."""
    if not sub:
        return None
    now = datetime.now(timezone.utc)
    is_expired = bool(sub.expires_at and sub.expires_at < now)
    tokens_allowed = int(sub.tokens_allowed_override or (plan.monthly_token_allowance if plan else 0))
    usage = _tokens_used_in_window(db, sub.user_id, sub.started_at, None)
    tokens_used = usage["total_tokens"]
    tokens_left = max(0, tokens_allowed - tokens_used)
    pct_used = round(100.0 * tokens_used / tokens_allowed, 1) if tokens_allowed else 0.0
    return {
        "id": sub.id,
        "plan_id": sub.plan_id,
        "plan_name": plan.name if plan else None,
        "monthly_price_inr": float(plan.monthly_price_inr or 0) if plan else 0.0,
        "started_at": sub.started_at.isoformat() if sub.started_at else None,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        "is_free_trial": bool(sub.is_free_trial),
        "status": sub.status,
        "notes": sub.notes,
        "is_expired": is_expired,
        "tokens_allowed": tokens_allowed,
        "tokens_used": tokens_used,
        "tokens_left": tokens_left,
        "pct_used": pct_used,
        "usage": usage,
    }


def _active_sub_for(db: Session, user_id: int) -> tuple[UserSubscription | None, SubscriptionPlan | None]:
    """Return the CURRENT active subscription for a user (and its plan)."""
    sub = db.scalar(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id, UserSubscription.status == "active")
        .order_by(desc(UserSubscription.id))
        .limit(1)
    )
    if not sub:
        return None, None
    plan = db.get(SubscriptionPlan, sub.plan_id)
    return sub, plan


# ==========================================================================
# ADMIN — Subscription plans
# ==========================================================================
@router.get("/admin/billing/plans")
def list_plans(admin: User = Depends(_admin), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(SubscriptionPlan).order_by(SubscriptionPlan.sort_order, SubscriptionPlan.id)
    ).all()
    return [_plan_out(p) for p in rows]


@router.post("/admin/billing/plans")
def create_plan(body: PlanIn, admin: User = Depends(_admin),
                db: Session = Depends(get_db)) -> dict:
    if not body.name.strip():
        raise HTTPException(400, "Plan name is required")
    if db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.name == body.name.strip())):
        raise HTTPException(409, "A plan with that name already exists")
    p = SubscriptionPlan(
        name=body.name.strip(),
        description=(body.description or None),
        monthly_price_inr=body.monthly_price_inr,
        yearly_price_inr=body.yearly_price_inr,
        monthly_token_allowance=body.monthly_token_allowance,
        is_active=body.is_active,
        sort_order=body.sort_order,
        features=list(body.features or []),
        is_featured=body.is_featured,
        badge=body.badge,
        savings_note=body.savings_note,
        annual_discount_pct=body.annual_discount_pct,
    )
    db.add(p); db.commit(); db.refresh(p)
    return _plan_out(p)


@router.patch("/admin/billing/plans/{plan_id}")
def patch_plan(plan_id: int, body: PlanPatch,
               admin: User = Depends(_admin), db: Session = Depends(get_db)) -> dict:
    p = db.get(SubscriptionPlan, plan_id)
    if not p:
        raise HTTPException(404, "Plan not found")
    for attr in ("name", "description", "monthly_price_inr", "yearly_price_inr",
                 "monthly_token_allowance", "is_active", "sort_order",
                 "features", "is_featured", "badge", "savings_note",
                 "annual_discount_pct"):
        val = getattr(body, attr)
        if val is not None:
            setattr(p, attr, val)
    # An explicit 0 sent for yearly_price_inr means "clear the override,
    # auto-compute again" — PlanPatch declared it as Optional[float] so
    # the "is not None" gate above ignores it; treat 0 as sentinel here.
    if body.yearly_price_inr == 0:
        p.yearly_price_inr = None
    db.commit(); db.refresh(p)
    return _plan_out(p)


@router.delete("/admin/billing/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: int, force: bool = False,
                admin: User = Depends(_admin),
                db: Session = Depends(get_db)) -> None:
    p = db.get(SubscriptionPlan, plan_id)
    if not p:
        return
    # Two kinds of blockers, treated separately for clarity:
    #   • active_holders — users currently subscribed. Deleting these silently
    #     would leave live users with no plan. NEVER auto-cascade; require
    #     the admin to reassign first.
    #   • historical_holders — expired / cancelled subscriptions. Postgres's
    #     FK still blocks the delete, but these are just audit records and
    #     `?force=true` sweeps them out.
    active_holders = db.scalar(
        select(func.count(UserSubscription.id))
        .where(UserSubscription.plan_id == plan_id,
               UserSubscription.status == "active")
    ) or 0
    if active_holders:
        raise HTTPException(
            409,
            f"{active_holders} active subscription(s) still on this plan — "
            f"reassign those users to another plan before deleting.",
        )
    total_holders = db.scalar(
        select(func.count(UserSubscription.id))
        .where(UserSubscription.plan_id == plan_id)
    ) or 0
    if total_holders and not force:
        raise HTTPException(
            409,
            f"{total_holders} historical (expired/cancelled) subscription(s) "
            f"reference this plan. Re-issue the delete with ?force=true to "
            f"drop them along with the plan.",
        )
    if force and total_holders:
        db.execute(
            UserSubscription.__table__.delete().where(
                UserSubscription.plan_id == plan_id,
            ),
        )
    db.delete(p); db.commit()


# ==========================================================================
# ADMIN — Token rates (per 1k tokens, INR)
# ==========================================================================
@router.get("/admin/billing/token-rates")
def list_token_rates(admin: User = Depends(_admin),
                     db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(TokenPrice).order_by(desc(TokenPrice.is_active), TokenPrice.model_slug, desc(TokenPrice.id))
    ).all()
    return [_rate_out(r) for r in rows]


@router.post("/admin/billing/token-rates")
def create_token_rate(body: TokenRateIn, admin: User = Depends(_admin),
                      db: Session = Depends(get_db)) -> dict:
    slug = (body.model_slug or "").strip()
    if not slug:
        raise HTTPException(400, "model_slug is required")
    # Mark any previous active rate for this slug inactive so we keep a
    # history but only one row is "current".
    db.execute(
        update(TokenPrice)
        .where(TokenPrice.model_slug == slug, TokenPrice.is_active == True)  # noqa: E712
        .values(is_active=False)
    )
    r = TokenPrice(
        model_slug=slug,
        provider=(body.provider or None),
        input_price_per_1k_inr=body.input_price_per_1k_inr,
        output_price_per_1k_inr=body.output_price_per_1k_inr,
        is_active=True,
        notes=(body.notes or None),
    )
    db.add(r); db.commit(); db.refresh(r)
    return _rate_out(r)


@router.patch("/admin/billing/token-rates/{rate_id}")
def patch_token_rate(rate_id: int, body: TokenRatePatch,
                     admin: User = Depends(_admin),
                     db: Session = Depends(get_db)) -> dict:
    r = db.get(TokenPrice, rate_id)
    if not r:
        raise HTTPException(404, "Rate not found")
    for attr in ("model_slug", "provider", "input_price_per_1k_inr",
                 "output_price_per_1k_inr", "is_active", "notes"):
        val = getattr(body, attr)
        if val is not None:
            setattr(r, attr, val)
    db.commit(); db.refresh(r)
    return _rate_out(r)


@router.delete("/admin/billing/token-rates/{rate_id}", status_code=204)
def delete_token_rate(rate_id: int, admin: User = Depends(_admin),
                      db: Session = Depends(get_db)) -> None:
    r = db.get(TokenPrice, rate_id)
    if r:
        db.delete(r); db.commit()


# ==========================================================================
# ADMIN — User billing overview
# ==========================================================================
@router.get("/admin/billing/users")
def admin_billing_users(admin: User = Depends(_admin),
                        db: Session = Depends(get_db)) -> dict:
    # Scope: wing-admin sees own wing only; super-admin sees everyone.
    q = select(User).where(User.role == Role.officer)
    if admin.role == Role.wing_admin:
        q = q.where(User.wing_id == admin.wing_id)
    users = db.scalars(q).all()

    rows = []
    for u in users:
        sub, plan = _active_sub_for(db, u.id)
        snap = _sub_snapshot(db, sub, plan)
        rows.append({
            "user_id": u.id,
            "username": u.username,
            "full_name": u.full_name,
            "email": u.email,
            "wing_id": u.wing_id,
            "is_active": bool(u.is_active),
            "current_subscription": snap,
        })
    # Sort: those with no plan first (admin needs to assign), then by tokens_left ascending
    rows.sort(key=lambda r: (
        0 if r["current_subscription"] is None else 1,
        (r["current_subscription"] or {}).get("tokens_left", 0),
    ))
    return {"users": rows, "count": len(rows)}


@router.post("/admin/billing/users/{user_id}/assign")
def admin_assign_plan(user_id: int, body: AssignPlanIn,
                      admin: User = Depends(_admin),
                      db: Session = Depends(get_db)) -> dict:
    """Assign a plan to a user. If they have an active sub, it gets
    superseded (marked `expired`) and a fresh one is created."""
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    if admin.role == Role.wing_admin and u.wing_id != admin.wing_id:
        raise HTTPException(403, "User not in your wing")
    plan = db.get(SubscriptionPlan, body.plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")

    # Supersede any existing active sub.
    db.execute(
        update(UserSubscription)
        .where(UserSubscription.user_id == user_id, UserSubscription.status == "active")
        .values(status="expired")
    )

    now = datetime.now(timezone.utc)
    expires_at = None
    if body.duration_days and body.duration_days > 0:
        expires_at = now + timedelta(days=body.duration_days)

    sub = UserSubscription(
        user_id=user_id,
        plan_id=plan.id,
        started_at=now,
        expires_at=expires_at,
        tokens_allowed_override=body.tokens_allowed_override,
        is_free_trial=body.is_free_trial,
        granted_by_admin_id=admin.id,
        status="active",
        notes=body.notes,
    )
    db.add(sub); db.commit(); db.refresh(sub)
    return _sub_snapshot(db, sub, plan) or {}


@router.patch("/admin/billing/subscriptions/{sub_id}")
def admin_patch_subscription(sub_id: int, body: SubscriptionPatch,
                             admin: User = Depends(_admin),
                             db: Session = Depends(get_db)) -> dict:
    sub = db.get(UserSubscription, sub_id)
    if not sub:
        raise HTTPException(404, "Subscription not found")
    u = db.get(User, sub.user_id)
    if admin.role == Role.wing_admin and u and u.wing_id != admin.wing_id:
        raise HTTPException(403, "User not in your wing")
    for attr in ("started_at", "expires_at", "tokens_allowed_override",
                 "status", "notes", "is_free_trial"):
        val = getattr(body, attr)
        if val is not None:
            setattr(sub, attr, val)
    db.commit()
    plan = db.get(SubscriptionPlan, sub.plan_id)
    return _sub_snapshot(db, sub, plan) or {}


# ==========================================================================
# USER — /billing/me
# ==========================================================================
@router.get("/billing/me")
def my_billing(p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> dict:
    sub, plan = _active_sub_for(db, p.user.id)
    snap = _sub_snapshot(db, sub, plan)

    # Historical subs (last 12) for the timeline widget.
    prior = db.scalars(
        select(UserSubscription)
        .where(UserSubscription.user_id == p.user.id)
        .order_by(desc(UserSubscription.id)).limit(12)
    ).all()
    history = []
    for s in prior:
        pl = db.get(SubscriptionPlan, s.plan_id)
        window_end = s.expires_at
        usage = _tokens_used_in_window(db, p.user.id, s.started_at, window_end)
        history.append({
            "id": s.id,
            "plan_name": pl.name if pl else None,
            "monthly_price_inr": float(pl.monthly_price_inr or 0) if pl else 0.0,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "is_free_trial": bool(s.is_free_trial),
            "status": s.status,
            "usage": usage,
        })

    # Spend breakdown for the CURRENT subscription window, keyed by action.
    breakdown = []
    if sub:
        rows = db.execute(
            select(
                TokenUsage.action,
                func.count(TokenUsage.id),
                func.coalesce(func.sum(TokenUsage.total_tokens), 0),
                func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
                func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
            )
            .where(
                TokenUsage.user_id == p.user.id,
                TokenUsage.created_at >= sub.started_at,
            )
            .group_by(TokenUsage.action)
            .order_by(desc(func.sum(TokenUsage.total_tokens)))
        ).all()
        for action, calls, tt, pt, ct in rows:
            breakdown.append({
                "action": action, "calls": int(calls),
                "prompt_tokens": int(pt), "completion_tokens": int(ct),
                "total_tokens": int(tt),
            })

    # Compute estimated INR cost using current active token_prices.
    rates_by_model = {
        r.model_slug: r for r in db.scalars(
            select(TokenPrice).where(TokenPrice.is_active == True)  # noqa: E712
        )
    }
    cost_inr = 0.0
    if sub:
        model_rows = db.execute(
            select(
                TokenUsage.model,
                func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
                func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
            )
            .where(
                TokenUsage.user_id == p.user.id,
                TokenUsage.created_at >= sub.started_at,
            )
            .group_by(TokenUsage.model)
        ).all()
        for model, pt, ct in model_rows:
            r = rates_by_model.get(model or "")
            if not r:
                continue
            cost_inr += (int(pt) / 1000.0) * float(r.input_price_per_1k_inr or 0)
            cost_inr += (int(ct) / 1000.0) * float(r.output_price_per_1k_inr or 0)

    grounding_cost = float((snap or {}).get("usage", {}).get("grounding_cost_est_inr", 0) or 0)
    total_cost = cost_inr + grounding_cost

    return {
        "current_subscription": snap,
        "spend_breakdown": breakdown,
        "estimated_period_cost_inr": round(total_cost, 2),
        "token_cost_inr": round(cost_inr, 2),
        "grounding_cost_inr": round(grounding_cost, 2),
        "history": history,
    }


# ==========================================================================
# PUBLIC — plans catalogue (so the user-billing page can show what's on offer)
# ==========================================================================
@router.get("/billing/plans")
def public_plans(p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> list[dict]:
    # Only surface active plans, ordered by admin's sort_order.
    rows = db.scalars(
        select(SubscriptionPlan)
        .where(SubscriptionPlan.is_active == True)  # noqa: E712
        .order_by(SubscriptionPlan.sort_order, SubscriptionPlan.id)
    ).all()
    return [_plan_out(pl) for pl in rows]


# ==========================================================================
# UNAUTHENTICATED — the marketing landing page fetches active plans here so
# any admin edit to price / features / badge propagates without a re-deploy.
# The auto-granted Free Trial plan is excluded — it's not a purchase decision.
# ==========================================================================
@router.get("/public/pricing-plans")
def public_pricing_plans(db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(SubscriptionPlan)
        .where(SubscriptionPlan.is_active == True)  # noqa: E712
        .where(SubscriptionPlan.monthly_price_inr > 0)  # skip Free Trial
        .order_by(SubscriptionPlan.sort_order, SubscriptionPlan.id)
    ).all()
    return [_plan_out(pl) for pl in rows]
