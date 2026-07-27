"""Public contact form — accepts enquiries from the marketing site without
auth, with light rate-limiting to deter abuse. Admins read them back via
GET /contact (super_admin / wing_admin only)."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.core.ratelimit import enforce
from app.models.contact import ContactMessage

router = APIRouter(prefix="/contact", tags=["contact"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class ContactIn(BaseModel):
    name: str
    email: str
    organisation: str | None = None
    topic: str | None = None
    message: str


@router.post("", status_code=201)
def submit_contact(body: ContactIn, request: Request, db: Session = Depends(get_db)) -> dict:
    # Max 5 submissions / 10 min per IP.
    enforce(request, "contact", max_hits=5, window_s=600)
    name = (body.name or "").strip()
    email = (body.email or "").strip()
    message = (body.message or "").strip()
    if not name or not message:
        raise HTTPException(400, "Name and message are required.")
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "A valid email is required.")
    m = ContactMessage(
        name=name[:200], email=email[:255],
        organisation=(body.organisation or "").strip()[:200] or None,
        topic=(body.topic or "").strip()[:60] or None,
        message=message[:5000],
    )
    db.add(m)
    db.commit()
    return {"ok": True, "message": "Thanks — we'll be in touch shortly."}


@router.get("")
def list_contact(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    if p.user.role not in ("super_admin", "wing_admin"):
        raise HTTPException(404, "Not found")
    rows = db.scalars(
        select(ContactMessage).order_by(desc(ContactMessage.created_at)).limit(200)
    )
    return [{"id": m.id, "name": m.name, "email": m.email, "organisation": m.organisation,
             "topic": m.topic, "message": m.message, "handled": m.handled,
             "created_at": m.created_at.isoformat() if m.created_at else None} for m in rows]
