"""Draft review & approval service.

Access model (mirrors the matter-share owner-OR-shared gate):
  * The drafter (owner) can always see the draft; they can EDIT it except while
    it is out for review.
  * The chosen reviewer can see and EDIT the draft only while status == in_review.
Cross-user access that fails these gates is surfaced by the route as 404, per the
established convention.

State machine on DraftDocument.status:
  draft ──send──▶ in_review ──approve──▶ approved
                     │
                     └────return───────▶ returned ──(edit + send again)──▶ in_review
Every transition writes a DraftReview row / resolution and an audit-log event.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core import department as _dept
from app.core.profiles import role_tier
from app.models.draft_review import DraftReview
from app.models.drafting import DraftDocument
from app.models.org import User
from app.services import audit

# Fold the canonical 5-tier taxonomy onto the 3 seniority buckets the reviewer
# list reports (so "recommended" matching is apples-to-apples).
_FOLD_TIER = {"ministerial": "", "field": "field", "range": "range",
              "commissioner": "commissioner", "apex": "commissioner"}


def _years_from_ay(ay: str | None) -> float | None:
    """Years elapsed since the end of an assessment year like '2022-23'."""
    import re as _re
    from datetime import date
    m = _re.match(r"(20\d{2})-(\d{2})", (ay or "").strip())
    if not m:
        return None
    ay_end = date(int(m.group(1)) + 1, 3, 31)   # AY 2022-23 ends 31 Mar 2023
    return max(0.0, (date.today() - ay_end).days / 365.25)


def required_approval_for_draft(d: DraftDocument) -> dict | None:
    """The statutory sanction a draft needs, and who can give it — mapping the
    draft's kind → section → the approval authority (department.APPROVALS).
    Returns None for drafts that carry no special approval."""
    kind = (d.kind or "").lower()
    if "148" in kind:
        section = "151"
    elif "153a" in kind or "153c" in kind or "153d" in kind:
        section = "153D"
    elif "144c" in kind:
        section = "144C"
    elif "263" in kind:
        section = "263"
    elif "264" in kind:
        section = "264"
    else:
        return None
    inputs = d.inputs or {}
    years = _years_from_ay(inputs.get("ay") or inputs.get("assessment_year")) if section == "151" else None
    auth_keys = _dept.approver_for(section, years_elapsed=years) or []
    info = _dept.APPROVALS_BY_SECTION.get(section, {})
    labels = [_dept.DESIGNATIONS_BY_KEY.get(k, {}).get("label", k) for k in auth_keys]
    tiers = sorted({_FOLD_TIER.get(_dept.designation_tier(k) or "", "") for k in auth_keys} - {""})
    return {
        "section": section,
        "what": info.get("what", ""),
        "authority": labels,
        "required_tiers": tiers,
        "note": info.get("note", ""),
        "years_elapsed": round(years, 1) if years is not None else None,
    }

_TIER_RANK = {"commissioner": 0, "range": 1, "field": 2, "": 3}


# --- access gates -----------------------------------------------------------
def reviewable_draft(db: Session, draft_id: int, user_id: int) -> DraftDocument | None:
    """The draft if this user may VIEW it (owner always; reviewer while in review)."""
    d = db.get(DraftDocument, draft_id)
    if not d:
        return None
    if d.user_id == user_id:
        return d
    if d.reviewer_user_id == user_id and d.status == "in_review":
        return d
    return None


def can_edit(d: DraftDocument, user_id: int) -> bool:
    """Owner edits except while out for review; reviewer edits only during review."""
    if d.user_id == user_id:
        return d.status != "in_review"
    if d.reviewer_user_id == user_id:
        return d.status == "in_review"
    return False


# --- eligible reviewers -----------------------------------------------------
def list_reviewers(db: Session, me: User) -> list[dict]:
    """Active colleagues in the same wing (same-office and seniors surfaced
    first) the drafter can send a draft to. Excludes the drafter."""
    rows = list(db.scalars(
        select(User).where(
            User.wing_id == me.wing_id, User.id != me.id, User.is_active.is_(True))
        .limit(300)))
    out = []
    for u in rows:
        tier = role_tier(u.designation)
        out.append({
            "id": u.id,
            "full_name": u.full_name or u.username,
            "designation": u.designation,
            "tier": tier,
            "is_senior": tier in ("range", "commissioner"),
            "same_office": bool(me.office_id and u.office_id == me.office_id),
        })
    out.sort(key=lambda x: (0 if x["same_office"] else 1,
                            _TIER_RANK.get(x["tier"], 3),
                            (x["full_name"] or "").lower()))
    return out


# --- transitions ------------------------------------------------------------
def send_for_review(db: Session, d: DraftDocument, drafter: User,
                    reviewer_id: int, note: str) -> str:
    """Owner sends the draft up to a senior. Returns a status string:
    'ok' | 'not_owner' | 'already' | 'no_reviewer'."""
    if d.user_id != drafter.id:
        return "not_owner"
    if d.status == "in_review":
        return "already"
    reviewer = db.get(User, reviewer_id)
    if (not reviewer or reviewer.id == drafter.id or not reviewer.is_active
            or reviewer.wing_id != drafter.wing_id):
        return "no_reviewer"

    d.status = "in_review"
    d.reviewer_user_id = reviewer.id
    db.add(DraftReview(
        draft_id=d.id, drafter_user_id=drafter.id, reviewer_user_id=reviewer.id,
        status="pending", request_note=(note or "")[:2000]))
    audit.log_event(db, action="draft_review.sent", user_id=drafter.id,
                    wing_id=drafter.wing_id, resource_type="draft",
                    resource_id=str(d.id), query_text=(note or "")[:200], commit=False)
    db.commit()
    return "ok"


def _resolve(db: Session, d: DraftDocument, reviewer: User,
             new_status: str, remarks: str) -> str:
    """Reviewer approves or returns. Returns 'ok' | 'not_reviewer' | 'not_in_review'."""
    if d.reviewer_user_id != reviewer.id:
        return "not_reviewer"
    if d.status != "in_review":
        return "not_in_review"
    rev = db.scalar(
        select(DraftReview).where(
            DraftReview.draft_id == d.id, DraftReview.status == "pending")
        .order_by(desc(DraftReview.id)))
    if rev:
        rev.status = new_status
        rev.review_remarks = (remarks or "")[:4000]
        rev.resolved_at = datetime.now(timezone.utc)
    d.status = new_status
    audit.log_event(db, action=f"draft_review.{new_status}", user_id=reviewer.id,
                    wing_id=reviewer.wing_id, resource_type="draft",
                    resource_id=str(d.id), query_text=(remarks or "")[:200], commit=False)
    db.commit()
    return "ok"


def approve(db: Session, d: DraftDocument, reviewer: User, remarks: str) -> str:
    return _resolve(db, d, reviewer, "approved", remarks)


def return_draft(db: Session, d: DraftDocument, reviewer: User, remarks: str) -> str:
    return _resolve(db, d, reviewer, "returned", remarks)


# --- reads ------------------------------------------------------------------
def inbox(db: Session, reviewer_id: int) -> list[DraftDocument]:
    """Drafts awaiting THIS user's review."""
    return list(db.scalars(
        select(DraftDocument).where(
            DraftDocument.reviewer_user_id == reviewer_id,
            DraftDocument.status == "in_review")
        .order_by(desc(DraftDocument.updated_at)).limit(200)))


def inbox_count(db: Session, reviewer_id: int) -> int:
    from sqlalchemy import func
    return int(db.scalar(
        select(func.count(DraftDocument.id)).where(
            DraftDocument.reviewer_user_id == reviewer_id,
            DraftDocument.status == "in_review")) or 0)


def _name(db: Session, uid: int | None) -> str | None:
    if not uid:
        return None
    u = db.get(User, uid)
    return (u.full_name or u.username) if u else None


def history(db: Session, draft_id: int) -> list[dict]:
    """The full send/approve/return trail for a draft — the audit record."""
    rows = db.scalars(
        select(DraftReview).where(DraftReview.draft_id == draft_id)
        .order_by(DraftReview.id))
    out = []
    for r in rows:
        out.append({
            "status": r.status,
            "drafter": _name(db, r.drafter_user_id),
            "reviewer": _name(db, r.reviewer_user_id),
            "request_note": r.request_note or "",
            "review_remarks": r.review_remarks or "",
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        })
    return out


def review_info(db: Session, d: DraftDocument, viewer_id: int) -> dict:
    """Review context for a draft view: current reviewer, whether the viewer may
    edit, whether the viewer is the reviewer, and the history trail."""
    return {
        "reviewer_user_id": d.reviewer_user_id,
        "reviewer_name": _name(db, d.reviewer_user_id),
        "is_reviewer": d.reviewer_user_id == viewer_id and d.status == "in_review",
        "is_owner": d.user_id == viewer_id,
        "can_edit": can_edit(d, viewer_id),
        "required_approval": required_approval_for_draft(d),
        "history": history(db, d.id),
    }
