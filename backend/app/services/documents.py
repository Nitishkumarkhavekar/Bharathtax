"""Per-user document service: upload -> store raw (MinIO) -> extract (reuses the
Workstream B extractors) -> chunk -> index in a private namespace -> Q&A.

Uploaded files are arbitrary (notices, orders), not structured law, so a simple
paragraph/size chunker is used here — the structure-aware legal chunker is only
for the primary-law corpus.
"""
from __future__ import annotations

import hashlib

from sqlalchemy.orm import Session

from app.core.enums import DocumentStatus
from app.core.logging import get_logger
from app.ingestion.extract import extract_text
from app.models.documents import Document, DocumentChunk
from app.services import embeddings as emb
from app.services import storage

log = get_logger(__name__)
_TARGET = 800   # chars per chunk
_OVERLAP = 100


def namespace_for(user_id: int, document_id: int) -> str:
    return f"user:{user_id}:doc:{document_id}"


def _chunk_plain(text: str) -> list[str]:
    """Paragraph-aware packing with light overlap. Acceptable for arbitrary docs."""
    paras = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paras:
        if len(buf) + len(p) + 2 <= _TARGET:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                chunks.append(buf)
            if len(p) <= _TARGET:
                buf = p
            else:  # a single huge paragraph: hard-split with overlap
                for i in range(0, len(p), _TARGET - _OVERLAP):
                    chunks.append(p[i : i + _TARGET])
                buf = ""
    if buf:
        chunks.append(buf)
    return chunks


def create_document(db: Session, *, owner_user_id: int, wing_id: int, filename: str,
                    content_type: str, raw: bytes) -> Document:
    doc = Document(
        owner_user_id=owner_user_id,
        wing_id=wing_id,
        namespace="",  # set after we have an id
        filename=filename,
        content_type=content_type,
        minio_key="",
        status=DocumentStatus.uploaded,
    )
    db.add(doc)
    db.flush()
    doc.namespace = namespace_for(owner_user_id, doc.id)
    checksum = hashlib.sha256(raw).hexdigest()
    doc.minio_key = f"documents/{doc.namespace}/{checksum}_{filename}"
    storage.put_bytes(doc.minio_key, raw, content_type)
    db.commit()
    return doc


def index_document(db: Session, doc: Document, raw: bytes) -> int:
    doc.status = DocumentStatus.processing
    db.commit()
    try:
        text = extract_text(raw, doc.content_type or "", filename=doc.filename)
        pieces = _chunk_plain(text)
        vectors = emb.embed(pieces) if pieces else []
        for piece, vec in zip(pieces, vectors):
            db.add(DocumentChunk(
                document_id=doc.id, namespace=doc.namespace, text=piece, embedding=vec
            ))
        doc.status = DocumentStatus.indexed
        db.commit()
        log.info("indexed document %s: %d chunks", doc.id, len(pieces))
        return len(pieces)
    except Exception:
        doc.status = DocumentStatus.failed
        db.commit()
        raise
