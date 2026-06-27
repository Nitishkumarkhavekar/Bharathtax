"""Ask Bot route: ask the primary-law corpus, get a grounded, cited answer.
Every query is persisted and audit-logged."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal, require_license
from app.core.db import get_db
from app.models.org import User
from app.core.enums import Domain, QueryScope
from app.models.activity import Query
from app.schemas import AnswerResponse, AskRequest, CitationOut
from app.services import audit, rag

router = APIRouter(prefix="/ask", tags=["ask"])


def _domain(value: str | None) -> Domain | None:
    if not value:
        return None
    try:
        return Domain(value)
    except ValueError:
        return None


@router.post("", response_model=AnswerResponse)
def ask(body: AskRequest, request: Request,
        p: Principal = Depends(get_principal),
        _licensed: User = Depends(require_license),
        db: Session = Depends(get_db)) -> AnswerResponse:
    started = time.monotonic()
    domain = _domain(body.domain)
    result = rag.answer_question(db, body.question, domain=domain)
    latency = int((time.monotonic() - started) * 1000)

    citations = [
        CitationOut(n=c.n, chunk_id=c.chunk_id, breadcrumb=c.breadcrumb,
                    source_url=c.source_url, section_number=c.section_number)
        for c in result.citations
    ]
    q = Query(
        user_id=p.user.id, wing_id=p.user.wing_id, scope=QueryScope.corpus,
        domain=body.domain, question=body.question, answer=result.text,
        citations=[c.model_dump() for c in citations],
        retrieval_meta={**result.meta, "grounded": result.grounded}, latency_ms=latency,
    )
    db.add(q)
    db.commit()
    audit.log_event(db, action="ask", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="query", resource_id=str(q.id),
                    query_text=body.question, **client_meta(request))
    return AnswerResponse(
        query_id=q.id, scope=QueryScope.corpus, grounded=result.grounded,
        answer=result.text, citations=citations, meta=result.meta, latency_ms=latency,
    )
