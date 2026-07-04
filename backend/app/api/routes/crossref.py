"""Cross-reference / section-hub endpoint: GET /crossref?section=68 -> the statutory
text, CBDT circulars/notifications, and leading judgments (with headnotes) for a
section, all linked from the extracted sections_cited data."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal
from app.core.db import get_db
from app.services import audit
from app.services.crossref import cross_references

router = APIRouter(prefix="/crossref", tags=["crossref"])


@router.get("")
def crossref(section: str, request: Request,
             p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    res = cross_references(db, section)
    audit.log_event(db, action="crossref", user_id=p.user.id, wing_id=p.user.wing_id,
                    query_text=section, **client_meta(request))
    return res
