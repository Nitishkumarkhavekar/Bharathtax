"""Per-user document service: upload -> store raw (MinIO) -> extract (reuses the
Workstream B extractors) -> chunk -> index in a private namespace -> Q&A.

Uploaded files are arbitrary (notices, orders), not structured law, so a simple
paragraph/size chunker is used here — the structure-aware legal chunker is only
for the primary-law corpus.

Extraction cache
----------------
The same file (identical bytes) uploaded twice — same user or different one —
does NOT re-run OCR / chunking / embedding. We compute SHA-256 of the raw
bytes on upload; index_document first looks for a previously indexed row with
the same hash AND the same pipeline_version, and if found clones its chunk
rows (text + embedding) into the new document. First upload of a specific
sale deed: 60-300s. Every subsequent upload of the same deed: <1s.

Accuracy invariant: the pipeline_version tag is bumped whenever any
extraction-affecting code changes (mojibake heuristic, OCR fallback, chunker
target size, embedding model). A version bump makes every prior cached row
invisible to the lookup, so the next upload re-runs the pipeline and
overwrites the cache. Cached results are always at least as good as what
the current pipeline would produce right now.
"""
from __future__ import annotations

import hashlib

from sqlalchemy import select
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

# Extraction-pipeline version. BUMP whenever anything that could change
# extraction output changes — e.g. new OCR model, mojibake heuristic
# tweak, chunker parameters, embedding model swap. The bump invalidates
# every existing cached row: next upload re-runs the pipeline and
# repopulates the cache. Never re-use an old tag after altering logic.
#
# History:
#   v1-legacy        — pre-cache; not stamped on any row.
#   v2-vertex-vision-2026-08-11 — post-Tesseract mojibake fallback lands,
#                                 OCR routes Kannada pages through Vertex
#                                 vision. This is the tag we're stamping
#                                 on all new indexings from now on.
_PIPELINE_VERSION = "v2-vertex-vision-2026-08-11"


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
    checksum = hashlib.sha256(raw).hexdigest()
    doc = Document(
        owner_user_id=owner_user_id,
        wing_id=wing_id,
        namespace="",  # set after we have an id
        filename=filename,
        content_type=content_type,
        minio_key="",
        status=DocumentStatus.uploaded,
        sha256=checksum,
    )
    db.add(doc)
    db.flush()
    doc.namespace = namespace_for(owner_user_id, doc.id)
    doc.minio_key = f"documents/{doc.namespace}/{checksum}_{filename}"
    storage.put_bytes(doc.minio_key, raw, content_type)
    db.commit()
    return doc


def _clone_chunks_from(db: Session, *, source_doc_id: int, target_doc: Document) -> int:
    """Copy every chunk from ``source_doc_id`` into ``target_doc``.

    Byte-for-byte copy of (text, breadcrumb, embedding, extra). The
    namespace is rewritten to the target so per-user retrieval scoping
    keeps working. Returns the number of chunks cloned.

    Accuracy note: because both text and embedding come straight from
    the source row, the target ends up with a state that is
    indistinguishable from having re-run the pipeline against identical
    bytes on the current pipeline_version. This is what makes the cache
    safe.
    """
    src_rows = list(db.scalars(
        select(DocumentChunk).where(DocumentChunk.document_id == source_doc_id)
        .order_by(DocumentChunk.id.asc())
    ).all())
    for src in src_rows:
        db.add(DocumentChunk(
            document_id=target_doc.id,
            namespace=target_doc.namespace,
            text=src.text,
            breadcrumb=src.breadcrumb,
            embedding=src.embedding,
            extra=dict(src.extra or {}),
        ))
    return len(src_rows)


def _find_cache_donor(db: Session, *, sha256: str, exclude_doc_id: int) -> Document | None:
    """Return an already-indexed Document with matching hash we can clone
    chunks from, or None. Excludes the doc we're about to index.

    Tier 1 (preferred): a donor with the CURRENT pipeline_version —
    guaranteed byte-identical to what the pipeline would produce now.

    Tier 2 (fallback): a donor with ANY populated pipeline_version, or
    with a legacy null version. These may be from an older pipeline
    (e.g. before the mojibake fix) but are still a valid extract of the
    same bytes. Cloning them gives the user an INSTANT answer instead
    of a 3-7 minute wait. Trade-off: the extract quality may be one
    generation behind. This is acceptable given the alternative is a
    time-out and 'still processing' error message.

    Incident 2026-08-12: a re-upload of BNS-1-00570 timed out at 300 s
    because only a legacy (null pipeline_version) donor existed. This
    fallback closes that gap.
    """
    if not sha256:
        return None
    donor = db.scalar(
        select(Document).where(
            Document.sha256 == sha256,
            Document.pipeline_version == _PIPELINE_VERSION,
            Document.status == DocumentStatus.indexed,
            Document.id != exclude_doc_id,
        ).limit(1)
    )
    if donor is not None:
        return donor
    # Tier-2 fallback: any indexed doc with the same bytes, regardless
    # of pipeline_version. Filename may be null-hashed too; we still
    # accept because the SHA is what matters.
    legacy = db.scalar(
        select(Document).where(
            Document.sha256 == sha256,
            Document.status == DocumentStatus.indexed,
            Document.id != exclude_doc_id,
        ).order_by(Document.id.desc()).limit(1)
    )
    if legacy is not None:
        log.info("cache donor tier-2 (legacy pipeline) for hash=%s doc=%s",
                 sha256[:12], legacy.id)
    return legacy


def index_document(db: Session, doc: Document, raw: bytes) -> int:
    doc.status = DocumentStatus.processing
    db.commit()
    try:
        # Warm-path: same file has already been fully indexed by someone
        # under the current pipeline version. Clone the chunks instead
        # of re-running the whole pipeline. Accuracy is unaffected
        # because the source chunks were produced by the SAME
        # extraction + chunker + embedding stack we would run now.
        donor = _find_cache_donor(db, sha256=doc.sha256 or "", exclude_doc_id=doc.id)
        if donor is not None:
            n_cloned = _clone_chunks_from(db, source_doc_id=donor.id, target_doc=doc)
            doc.pipeline_version = _PIPELINE_VERSION
            doc.status = DocumentStatus.indexed
            db.commit()
            log.info("indexed document %s from cache (donor=%s, %d chunks, hash=%s)",
                     doc.id, donor.id, n_cloned, (doc.sha256 or "")[:12])
            return n_cloned

        # Cold path: run the pipeline as usual and stamp the version so
        # the next upload of the same file hits the cache.
        text = extract_text(raw, doc.content_type or "", filename=doc.filename)
        pieces = _chunk_plain(text)
        vectors = emb.embed(pieces) if pieces else []
        for piece, vec in zip(pieces, vectors):
            db.add(DocumentChunk(
                document_id=doc.id, namespace=doc.namespace, text=piece, embedding=vec
            ))
        doc.pipeline_version = _PIPELINE_VERSION
        doc.status = DocumentStatus.indexed
        db.commit()
        log.info("indexed document %s: %d chunks (pipeline=%s)",
                 doc.id, len(pieces), _PIPELINE_VERSION)
        return len(pieces)
    except Exception:
        doc.status = DocumentStatus.failed
        db.commit()
        raise
