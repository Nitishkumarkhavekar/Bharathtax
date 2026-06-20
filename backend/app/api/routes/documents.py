"""Document routes: upload a file, list mine, ask questions against one of them.
Access is owner-scoped; every upload and access is audit-logged."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal
from app.core.db import get_db
from app.core.enums import QueryScope
from app.models.activity import Query
from app.models.documents import Document
from app.schemas import AnswerResponse, CitationOut, DocAskRequest, DocumentOut
from app.services import audit, documents, rag

router = APIRouter(prefix="/documents", tags=["documents"])


def _owned(db: Session, doc_id: int, user_id: int) -> Document:
    doc = db.get(Document, doc_id)
    if not doc or doc.owner_user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="document not found")
    return doc


@router.post("", response_model=DocumentOut)
async def upload(request: Request, file: UploadFile = File(...),
                 p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> Document:
    raw = await file.read()
    doc = documents.create_document(
        db, owner_user_id=p.user.id, wing_id=p.user.wing_id,
        filename=file.filename or "upload", content_type=file.content_type or "", raw=raw,
    )
    documents.index_document(db, doc, raw)
    audit.log_event(db, action="doc_upload", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="document", resource_id=str(doc.id), **client_meta(request))
    return doc


@router.get("", response_model=list[DocumentOut])
def my_documents(p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> list[Document]:
    return list(db.scalars(
        select(Document).where(Document.owner_user_id == p.user.id).order_by(Document.created_at.desc())
    ))


@router.post("/{doc_id}/ask", response_model=AnswerResponse)
def ask_document(doc_id: int, body: DocAskRequest, request: Request,
                 p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> AnswerResponse:
    doc = _owned(db, doc_id, p.user.id)
    started = time.monotonic()
    result = rag.answer_document(db, body.question, namespace=doc.namespace)
    latency = int((time.monotonic() - started) * 1000)

    citations = [
        CitationOut(n=c.n, chunk_id=c.chunk_id, breadcrumb=c.breadcrumb,
                    source_url=c.source_url, section_number=c.section_number)
        for c in result.citations
    ]
    q = Query(
        user_id=p.user.id, wing_id=p.user.wing_id, scope=QueryScope.document,
        document_id=doc.id, question=body.question, answer=result.text,
        citations=[c.model_dump() for c in citations],
        retrieval_meta={**result.meta, "grounded": result.grounded}, latency_ms=latency,
    )
    db.add(q)
    db.commit()
    audit.log_event(db, action="doc_ask", user_id=p.user.id, wing_id=p.user.wing_id,
                    resource_type="document", resource_id=str(doc.id),
                    query_text=body.question, **client_meta(request))
    return AnswerResponse(
        query_id=q.id, scope=QueryScope.document, grounded=result.grounded,
        answer=result.text, citations=citations, meta=result.meta, latency_ms=latency,
    )
