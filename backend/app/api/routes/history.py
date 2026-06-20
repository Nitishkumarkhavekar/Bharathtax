"""Per-user query history."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.models.activity import Query
from app.schemas import HistoryItem

router = APIRouter(prefix="/history", tags=["history"])


@router.get("", response_model=list[HistoryItem])
def my_history(limit: int = 50, p: Principal = Depends(get_principal),
               db: Session = Depends(get_db)) -> list[Query]:
    return list(db.scalars(
        select(Query).where(Query.user_id == p.user.id)
        .order_by(Query.created_at.desc()).limit(limit)
    ))
