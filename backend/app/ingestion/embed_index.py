"""Embed chunks (bge-m3 via ml-server) and write CorpusChunk rows.

Writes the dense vector into pgvector; the sparse tsvector is a generated column
(maintained by Postgres). Parent-child links are resolved after flush. Effective-
date versioning is applied so amendments supersede rather than overwrite.
"""
from __future__ import annotations

from sqlalchemy import select

from app.core.enums import Domain
from app.core.logging import get_logger
from app.ingestion.contracts import Chunk
from app.ingestion.versioning import supersede_prior
from app.models.corpus import CorpusChunk, CorpusDocument
from app.services import embeddings as emb

log = get_logger(__name__)
_BATCH = 32


def index_document(db, *, document: CorpusDocument, source_id: int, domain: Domain,
                   chunks: list[Chunk], resume_from: int = 0) -> int:
    """Embed + persist all chunks for one corpus document, committing per batch so
    progress is durable and visible. Parent-child links resolve correctly because
    a parent always precedes its children in the list.

    `resume_from` lets a partially-ingested document continue: the first N chunks
    (already in the DB, in insertion order) are skipped, and their ids are loaded
    so later children can still link to parents in the skipped range. Returns rows
    written THIS call."""
    if not chunks:
        return 0

    index_to_id: dict[int, int] = {}   # position in `chunks` -> db id
    total = len(chunks)
    written = resume_from

    if resume_from:
        existing = db.scalars(
            select(CorpusChunk.id)
            .where(CorpusChunk.corpus_document_id == document.id)
            .order_by(CorpusChunk.id)
        ).all()
        for pos, cid in enumerate(existing):
            index_to_id[pos] = cid
        log.info("  resuming doc %s from chunk %d/%d", document.id, resume_from, total)

    for start in range(resume_from, total, _BATCH):
        batch = chunks[start : start + _BATCH]
        vectors = emb.embed([c.text for c in batch])
        rows: list[tuple[int, CorpusChunk]] = []
        for offset, (ch, vec) in enumerate(zip(batch, vectors)):
            row = CorpusChunk(
                corpus_document_id=document.id,
                source_id=source_id,
                domain=domain,
                text=ch.text,
                breadcrumb=ch.breadcrumb,
                chunk_level=ch.level,
                act_name=ch.act_name,
                section_number=ch.section_number,
                subsection=ch.subsection,
                clause=ch.clause,
                proviso_no=ch.proviso_no,
                explanation_no=ch.explanation_no,
                rule_number=ch.rule_number,
                subrule=ch.subrule,
                extra=ch.extra or {},
                embedding=vec,
                effective_date=ch.effective_date or document.published_date,
                is_current=True,
            )
            db.add(row)
            rows.append((start + offset, row))
        db.flush()  # assign ids for this batch

        for pos, row in rows:
            index_to_id[pos] = row.id
            parent_pos = chunks[pos].parent_index
            if parent_pos is not None and parent_pos in index_to_id:
                row.parent_chunk_id = index_to_id[parent_pos]
            supersede_prior(db, domain=domain, new=row, effective=row.effective_date)
        db.commit()
        written += len(rows)
        log.info("  embedded+indexed %d/%d chunks (doc %s)", written, total, document.id)

    return written
