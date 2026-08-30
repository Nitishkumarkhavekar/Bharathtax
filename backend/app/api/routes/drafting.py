"""Officer-side drafting API: templates + generate/store/edit notices & orders."""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.models.drafting import DraftDocument
from app.services import draft_review as review
from app.services import drafting as svc
from app.services import drafting_export

router = APIRouter(prefix="/drafts", tags=["drafting"])

# Owner-settable statuses via PUT (review states are set only by the workflow).
_OWNER_STATUSES = ("draft", "final")


class DraftCreate(BaseModel):
    kind: str
    inputs: dict = {}
    title: str | None = None


class DraftUpdate(BaseModel):
    content: str | None = None
    title: str | None = None
    status: str | None = None


class SendReview(BaseModel):
    reviewer_user_id: int
    note: str | None = None


class ReviewAction(BaseModel):
    remarks: str | None = None


def _out(d: DraftDocument) -> dict:
    return {"id": d.id, "kind": d.kind, "title": d.title, "inputs": d.inputs,
            "content": d.content, "status": d.status,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None}


@router.get("/templates")
def templates(p: Principal = Depends(get_principal)) -> list[dict]:
    # Ranked to the requesting officer's function — their wing's templates first.
    return svc.list_templates(p.user.workspace_profile, p.user.workspace_wings)


@router.get("")
def list_drafts(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(
        select(DraftDocument).where(DraftDocument.user_id == p.user.id)
        .order_by(desc(DraftDocument.updated_at)).limit(200)
    )
    return [{"id": d.id, "kind": d.kind, "title": d.title, "status": d.status,
             "updated_at": d.updated_at.isoformat() if d.updated_at else None} for d in rows]


# --- review & approval (literal paths BEFORE /{did} so they don't get captured) ---
@router.get("/reviewers")
def list_reviewers(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    """Colleagues in the drafter's wing a draft can be sent to for review."""
    return review.list_reviewers(db, p.user)


@router.get("/review-inbox")
def review_inbox(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[dict]:
    """Drafts awaiting THIS officer's review."""
    return [{"id": d.id, "kind": d.kind, "title": d.title, "status": d.status,
             "drafter": review._name(db, d.user_id),
             "updated_at": d.updated_at.isoformat() if d.updated_at else None}
            for d in review.inbox(db, p.user.id)]


@router.get("/review-inbox/count")
def review_inbox_count(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    """Badge count for the 'For my review' nav item."""
    return {"count": review.inbox_count(db, p.user.id)}


@router.post("")
def create_draft(body: DraftCreate, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> dict:
    if body.kind not in svc.TEMPLATES:
        raise HTTPException(400, "unknown draft type")
    content = svc.generate(db, p.user, body.kind, body.inputs or {})
    title = (body.title or "").strip() or _auto_title(body.kind, body.inputs)
    d = DraftDocument(user_id=p.user.id, wing_id=p.user.wing_id, kind=body.kind,
                      title=title, inputs=body.inputs or {}, content=content)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _out(d)


@router.get("/{did}")
def get_draft(did: int, p: Principal = Depends(get_principal),
              db: Session = Depends(get_db)) -> dict:
    # Owner OR the assigned reviewer (while in review) may view.
    d = review.reviewable_draft(db, did, p.user.id)
    if not d:
        raise HTTPException(404, "Not found")
    return {**_out(d), "review": review.review_info(db, d, p.user.id)}


@router.put("/{did}")
def update_draft(did: int, body: DraftUpdate, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> dict:
    d = review.reviewable_draft(db, did, p.user.id)
    if not d:
        raise HTTPException(404, "Not found")
    # Owner edits except while out for review; reviewer edits only during review.
    if (body.content is not None or body.title is not None) and not review.can_edit(d, p.user.id):
        raise HTTPException(409, "This draft is out for review and can't be edited right now")
    if body.content is not None:
        d.content = body.content
    if body.title is not None:
        d.title = body.title.strip()
    # Only the owner sets draft/final; review states are set by the workflow only.
    if body.status in _OWNER_STATUSES and d.user_id == p.user.id and d.status not in ("in_review",):
        d.status = body.status
    db.commit()
    db.refresh(d)
    return {**_out(d), "review": review.review_info(db, d, p.user.id)}


@router.post("/{did}/send-review")
def send_for_review(did: int, body: SendReview, p: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)) -> dict:
    d = db.get(DraftDocument, did)
    if not d or d.user_id != p.user.id:
        raise HTTPException(404, "Not found")
    st = review.send_for_review(db, d, p.user, body.reviewer_user_id, body.note or "")
    if st == "already":
        raise HTTPException(409, "This draft is already out for review")
    if st == "no_reviewer":
        raise HTTPException(400, "Pick a colleague in your wing to review this draft")
    if st != "ok":
        raise HTTPException(400, "Could not send for review")
    db.refresh(d)
    return {**_out(d), "review": review.review_info(db, d, p.user.id)}


@router.post("/{did}/approve")
def approve_draft(did: int, body: ReviewAction, p: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)) -> dict:
    return _resolve_review(db, did, p, "approve", body.remarks or "")


@router.post("/{did}/return")
def return_draft(did: int, body: ReviewAction, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> dict:
    return _resolve_review(db, did, p, "return", body.remarks or "")


def _resolve_review(db: Session, did: int, p: Principal, action: str, remarks: str) -> dict:
    # Only the assigned reviewer, and only while in review — else 404 (never leak).
    d = review.reviewable_draft(db, did, p.user.id)
    if not d or d.reviewer_user_id != p.user.id:
        raise HTTPException(404, "Not found")
    fn = review.approve if action == "approve" else review.return_draft
    st = fn(db, d, p.user, remarks)
    if st != "ok":
        raise HTTPException(409, "This draft is not awaiting your review")
    db.refresh(d)
    return {**_out(d), "review": review.review_info(db, d, p.user.id)}


@router.post("/{did}/regenerate")
def regenerate_draft(did: int, p: Principal = Depends(get_principal),
                     db: Session = Depends(get_db)) -> dict:
    d = db.get(DraftDocument, did)
    if not d or d.user_id != p.user.id:
        raise HTTPException(404, "Not found")
    d.content = svc.generate(db, p.user, d.kind, d.inputs or {})
    db.commit()
    db.refresh(d)
    return _out(d)


@router.get("/{did}/export.docx")
def export_docx(did: int, p: Principal = Depends(get_principal),
                db: Session = Depends(get_db)) -> Response:
    d = db.get(DraftDocument, did)
    if not d or d.user_id != p.user.id:
        raise HTTPException(404, "Not found")
    data = drafting_export.to_docx(d.title, d.content)
    fname = re.sub(r"[^A-Za-z0-9._-]+", "_", (d.title or "draft")).strip("_")[:80] or "draft"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{fname}.docx"'},
    )


@router.delete("/{did}", status_code=204)
def delete_draft(did: int, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> None:
    d = db.get(DraftDocument, did)
    if not d or d.user_id != p.user.id:
        raise HTTPException(404, "Not found")
    db.delete(d)
    db.commit()


def _auto_title(kind: str, inputs: dict) -> str:
    t = svc.TEMPLATES.get(kind, {})
    who = (inputs or {}).get("assessee", "").strip()
    ay = (inputs or {}).get("ay", "").strip()
    bits = [t.get("label", kind)]
    if who:
        bits.append(who)
    if ay:
        bits.append(f"AY {ay}")
    return " · ".join(bits)
