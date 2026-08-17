"""Public contact form — accepts enquiries from the marketing site without
auth, with light rate-limiting to deter abuse. Admins read them back via
GET /contact (super_admin / wing_admin only)."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.core.ratelimit import enforce
from app.models.contact import ContactMessage

router = APIRouter(prefix="/contact", tags=["contact"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Accept +/digits/spaces/hyphens/parens — 6-20 chars after stripping non-digits.
# We store the raw string but validate that a reasonable phone number is in it.
_MOBILE_DIGITS_RE = re.compile(r"\d")


class ContactIn(BaseModel):
    name: str
    email: str
    mobile: str | None = None
    organisation: str | None = None
    topic: str | None = None
    message: str


@router.post("", status_code=201)
def submit_contact(body: ContactIn, request: Request, db: Session = Depends(get_db)) -> dict:
    # Max 5 submissions / 10 min per IP.
    enforce(request, "contact", max_hits=5, window_s=600)
    name = (body.name or "").strip()
    email = (body.email or "").strip()
    mobile_raw = (body.mobile or "").strip()
    message = (body.message or "").strip()
    if not name or not message:
        raise HTTPException(400, "Name and message are required.")
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "A valid email is required.")
    # Mobile is required from the marketing form (leads want a call-back
    # number). Older API callers that don't send one still work because the
    # column is nullable, but the marketing form now insists.
    mobile: str | None = None
    if mobile_raw:
        digits = "".join(_MOBILE_DIGITS_RE.findall(mobile_raw))
        if len(digits) < 6 or len(digits) > 20:
            raise HTTPException(400, "Please enter a valid mobile number.")
        mobile = mobile_raw[:32]
    m = ContactMessage(
        name=name[:200], email=email[:255], mobile=mobile,
        organisation=(body.organisation or "").strip()[:200] or None,
        topic=(body.topic or "").strip()[:60] or None,
        message=message[:5000],
    )
    db.add(m)
    db.commit()
    return {"ok": True, "message": "Thanks — we'll be in touch shortly."}


def _require_admin(p: Principal) -> None:
    if p.user.role not in ("super_admin", "wing_admin"):
        raise HTTPException(404, "Not found")


def _out(m: ContactMessage) -> dict:
    return {"id": m.id, "name": m.name, "email": m.email, "mobile": m.mobile,
            "organisation": m.organisation, "topic": m.topic, "message": m.message,
            "handled": m.handled,
            "created_at": m.created_at.isoformat() if m.created_at else None}


@router.get("")
def list_contact(
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1, le=10_000),
    per_page: int = Query(20, ge=1, le=100),
    filter: str = Query("all", pattern="^(all|open|handled)$"),
) -> dict:
    """Paginated leads/enquiries list. Newest first — deliberately overrides
    the old handled-then-date secondary sort so 'Leads' behaves like an
    inbox (newest at top regardless of handled state)."""
    _require_admin(p)
    base = select(ContactMessage)
    count_base = select(func.count(ContactMessage.id))
    if filter == "open":
        base = base.where(ContactMessage.handled.is_(False))
        count_base = count_base.where(ContactMessage.handled.is_(False))
    elif filter == "handled":
        base = base.where(ContactMessage.handled.is_(True))
        count_base = count_base.where(ContactMessage.handled.is_(True))
    total = int(db.scalar(count_base) or 0)
    total_pages = max(1, (total + per_page - 1) // per_page)
    if page > total_pages:
        page = total_pages
    offset = (page - 1) * per_page
    rows = db.scalars(
        base.order_by(desc(ContactMessage.created_at))
            .offset(offset).limit(per_page)
    ).all()
    return {
        "items": [_out(m) for m in rows],
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
    }


class ContactPatch(BaseModel):
    handled: bool | None = None


@router.patch("/{cid}")
def patch_contact(cid: int, body: ContactPatch, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> dict:
    _require_admin(p)
    m = db.get(ContactMessage, cid)
    if not m:
        raise HTTPException(404, "Not found")
    if body.handled is not None:
        m.handled = bool(body.handled)
    db.commit()
    db.refresh(m)
    return _out(m)


@router.delete("/{cid}", status_code=204)
def delete_contact(cid: int, p: Principal = Depends(get_principal),
                   db: Session = Depends(get_db)) -> None:
    _require_admin(p)
    m = db.get(ContactMessage, cid)
    if m:
        db.delete(m)
        db.commit()
