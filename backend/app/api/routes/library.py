"""My Library API — an officer's saved answers, rulings and drafts.

Everything is scoped to the authenticated user. Saving is idempotent on the
source (kind + ref_id), so the client can render a simple saved/unsaved toggle.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.services import library as svc

router = APIRouter(prefix="/library", tags=["library"])

SavedKind = Literal["answer", "ruling", "draft", "note"]


class SaveIn(BaseModel):
    kind: SavedKind
    title: str = ""
    content: str = ""
    source_url: str | None = None
    sections: list[str] | None = None
    ref_id: str | None = None
    meta: dict | None = None


@router.get("")
def list_saved(kind: SavedKind | None = None, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> list[dict]:
    return [svc.item_out(it) for it in svc.list_items(db, p.user.id, kind=kind)]


@router.get("/refs")
def list_refs(kind: SavedKind | None = None, p: Principal = Depends(get_principal),
              db: Session = Depends(get_db)) -> list[str]:
    """The source ids this user has saved — for saved/unsaved toggles."""
    return svc.saved_refs(db, p.user.id, kind=kind)


@router.post("", status_code=201)
def create_saved(body: SaveIn, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> dict:
    if not (body.title or "").strip() and not (body.content or "").strip():
        raise HTTPException(400, "title or content is required")
    it = svc.save_item(
        db, p.user.id, kind=body.kind, title=body.title, content=body.content,
        source_url=body.source_url, sections=body.sections, ref_id=body.ref_id, meta=body.meta)
    return svc.item_out(it)


@router.delete("/{item_id}", status_code=204)
def remove_saved(item_id: int, p: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)) -> None:
    if not svc.delete_item(db, item_id, p.user.id):
        raise HTTPException(404, "Not found")


@router.delete("/by-ref/{kind}/{ref_id}", status_code=204)
def remove_saved_by_ref(kind: SavedKind, ref_id: str, p: Principal = Depends(get_principal),
                        db: Session = Depends(get_db)) -> None:
    """Un-save by source (the other half of a toggle). 204 whether or not a row
    existed — the end state (not saved) is the same."""
    svc.delete_by_ref(db, p.user.id, kind=kind, ref_id=ref_id)
