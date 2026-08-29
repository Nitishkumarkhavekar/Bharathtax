"""My Library service — save / list / delete an officer's kept work.

All reads and writes are scoped to a ``user_id``. Saving the same source twice
(same kind + ref_id) is idempotent: it returns the existing row rather than
duplicating. Saved rulings feed their sections back into the ruling-watchlist
inference, so keeping case law sharpens "fresh law for you".
"""
from __future__ import annotations

from sqlalchemy import delete, desc, select
from sqlalchemy.orm import Session

from app.models.library import SavedItem

_LIST_CAP = 500
_KINDS = {"answer", "ruling", "draft", "note"}


def list_items(db: Session, user_id: int, kind: str | None = None) -> list[SavedItem]:
    q = select(SavedItem).where(SavedItem.user_id == user_id)
    if kind:
        q = q.where(SavedItem.kind == kind)
    q = q.order_by(desc(SavedItem.created_at)).limit(_LIST_CAP)
    return list(db.scalars(q))


def save_item(db: Session, user_id: int, *, kind: str, title: str, content: str,
              source_url: str | None = None, sections: list[str] | None = None,
              ref_id: str | None = None, meta: dict | None = None) -> SavedItem:
    """Save one item. Idempotent on (user, kind, ref_id): re-saving the same
    source returns the existing row (so a UI toggle stays consistent)."""
    if kind not in _KINDS:
        kind = "note"
    if ref_id:
        existing = db.scalar(select(SavedItem).where(
            SavedItem.user_id == user_id, SavedItem.kind == kind, SavedItem.ref_id == ref_id))
        if existing:
            return existing
    item = SavedItem(
        user_id=user_id, kind=kind, title=(title or "")[:500], content=content or "",
        source_url=source_url, sections=sections or None, ref_id=ref_id, meta=meta or {},
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, item_id: int, user_id: int) -> bool:
    res = db.execute(delete(SavedItem).where(
        SavedItem.id == item_id, SavedItem.user_id == user_id))
    db.commit()
    return res.rowcount > 0


def delete_by_ref(db: Session, user_id: int, *, kind: str, ref_id: str) -> bool:
    """Un-save by source — the other half of a UI save/unsave toggle."""
    res = db.execute(delete(SavedItem).where(
        SavedItem.user_id == user_id, SavedItem.kind == kind, SavedItem.ref_id == ref_id))
    db.commit()
    return res.rowcount > 0


def saved_refs(db: Session, user_id: int, kind: str | None = None) -> list[str]:
    """The ref_ids this user has saved (for rendering saved/unsaved toggles)."""
    q = select(SavedItem.ref_id).where(
        SavedItem.user_id == user_id, SavedItem.ref_id.isnot(None))
    if kind:
        q = q.where(SavedItem.kind == kind)
    return [r for r in db.scalars(q.limit(_LIST_CAP)) if r]


def item_out(it: SavedItem) -> dict:
    return {
        "id": it.id,
        "kind": it.kind,
        "title": it.title,
        "content": it.content,
        "source_url": it.source_url,
        "sections": list(it.sections or []),
        "ref_id": it.ref_id,
        "created_at": it.created_at.isoformat() if it.created_at else None,
    }
