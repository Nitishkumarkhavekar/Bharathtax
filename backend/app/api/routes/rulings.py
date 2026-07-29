"""Rulings explorer: semantic search over the case-law corpus (domain=case_law).
Taxsutra-style judgment search, grounded in the ingested judgments."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal
from app.core.db import get_db
from app.core.enums import Domain
from app.services import audit
from app.services.retrieval import retrieve

router = APIRouter(prefix="/rulings", tags=["rulings"])


@router.get("")
def search(q: str, request: Request,
           p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    res = retrieve(db, q, domain=Domain.case_law)
    audit.log_event(db, action="rulings.search", user_id=p.user.id, wing_id=p.user.wing_id,
                    query_text=q, **client_meta(request))
    seen, results = set(), []
    for x in res.passages:
        if x.breadcrumb in seen:
            continue
        seen.add(x.breadcrumb)
        results.append({"breadcrumb": x.breadcrumb, "snippet": x.match_text[:300],
                        "source_url": x.source_url, "score": x.score, "chunk_id": x.chunk_id,
                        "digest": x.digest, "sections_cited": x.sections_cited})
    return {"grounded": res.grounded, "results": results, "meta": res.meta}
