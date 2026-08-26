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
from app.services import drafting as svc
from app.services import drafting_export

router = APIRouter(prefix="/drafts", tags=["drafting"])


class DraftCreate(BaseModel):
    kind: str
    inputs: dict = {}
    title: str | None = None


class DraftUpdate(BaseModel):
    content: str | None = None
    title: str | None = None
    status: str | None = None


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
    d = db.get(DraftDocument, did)
    if not d or d.user_id != p.user.id:
        raise HTTPException(404, "Not found")
    return _out(d)


@router.put("/{did}")
def update_draft(did: int, body: DraftUpdate, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> dict:
    d = db.get(DraftDocument, did)
    if not d or d.user_id != p.user.id:
        raise HTTPException(404, "Not found")
    if body.content is not None:
        d.content = body.content
    if body.title is not None:
        d.title = body.title.strip()
    if body.status in ("draft", "final"):
        d.status = body.status
    db.commit()
    db.refresh(d)
    return _out(d)


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
