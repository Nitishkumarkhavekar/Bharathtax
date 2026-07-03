"""Star ratings for generated appeal orders and chat answers. Stored one-per-user
per target (upsert) AND logged to ai_capture as a training signal — a 5-star draft
is a gold example, a 1-star one a negative."""
from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.services import capture

router = APIRouter(prefix="/ratings", tags=["ratings"])

_DDL = [
    """CREATE TABLE IF NOT EXISTS ratings (
        id BIGSERIAL PRIMARY KEY,
        ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        user_id INTEGER,
        stars INTEGER NOT NULL,
        comment TEXT,
        context TEXT,
        UNIQUE (target_type, target_id, user_id)
    )""",
    "CREATE INDEX IF NOT EXISTS ix_ratings_target ON ratings(target_type, target_id)",
]
_ensured = False


def _ensure(db: Session) -> None:
    global _ensured
    if _ensured:
        return
    for stmt in _DDL:
        db.execute(text(stmt))
    db.commit()
    _ensured = True


@router.post("")
def rate(body: dict, p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    tt = str(body.get("target_type") or "").strip()
    stars = int(body.get("stars") or 0)
    if tt not in ("appeal", "chat") or not (1 <= stars <= 5):
        raise HTTPException(400, "target_type in {appeal,chat} and stars 1-5 required")
    tid = str(body.get("target_id") or "").strip()
    comment = body.get("comment") or None
    context = body.get("context") or ""
    if tt == "chat":
        q = str(body.get("question") or "")
        a = str(body.get("answer") or "")
        if not tid:
            tid = hashlib.md5(q.encode("utf-8")).hexdigest()[:16] if q else "unkeyed"
        if not context:
            context = json.dumps({"question": q[:2000], "answer": a[:8000]}, ensure_ascii=False)
    if not tid:
        raise HTTPException(400, "target_id required")
    _ensure(db)
    db.execute(text(
        "INSERT INTO ratings (target_type, target_id, user_id, stars, comment, context) "
        "VALUES (:tt,:tid,:uid,:st,:c,:ctx) "
        "ON CONFLICT (target_type, target_id, user_id) "
        "DO UPDATE SET stars=EXCLUDED.stars, comment=EXCLUDED.comment, "
        "context=EXCLUDED.context, ts=now()"),
        {"tt": tt, "tid": tid, "uid": p.user.id, "st": stars, "c": comment, "ctx": context})
    db.commit()
    try:
        capture.log_event("rating", task=f"rating.{tt}", user_id=p.user.id,
                          context=context or None,
                          meta={"target_type": tt, "target_id": tid, "stars": stars,
                                "comment": comment})
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "stars": stars}


@router.get("/{target_type}/{target_id}")
def get_rating(target_type: str, target_id: str,
               p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    _ensure(db)
    row = db.execute(text(
        "SELECT stars, comment FROM ratings WHERE target_type=:tt AND target_id=:tid "
        "AND user_id=:uid"),
        {"tt": target_type, "tid": target_id, "uid": p.user.id}).fetchone()
    return {"stars": row[0] if row else None, "comment": row[1] if row else None}
