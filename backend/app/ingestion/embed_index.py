"""Embed chunks (bge-m3 via ml-server) and write CorpusChunk rows.

Writes the dense vector into pgvector; the sparse tsvector is a generated column
(maintained by Postgres). Parent-child links are resolved after flush. Effective-
date versioning is applied so amendments supersede rather than overwrite.
"""
from __future__ import annotations

from app.core.enums import Domain
from app.core.logging import get_logger
from app.ingestion.contracts import Chunk
from app.ingestion.versioning import supersede_prior
from app.models.corpus import CorpusChunk, CorpusDocument
from app.services import embeddings as emb

log = get_logger(__name__)
_BATCH = 32


def _embed_all(texts: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), _BATCH):
        out.extend(emb.embed(texts[i : i + _BATCH]))
    return out


def index_document(db, *, document: CorpusDocument, source_id: int, domain: Domain,
                   chunks: list[Chunk]) -> int:
    """Embed + persist all chunks for one corpus document. Returns rows written."""
    if not chunks:
        return 0
    vectors = _embed_all([c.text for c in chunks])

    rows: list[CorpusChunk] = []
    for ch, vec in zip(chunks, vectors):
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
        rows.append(row)
    db.flush()  # assign ids

    # resolve parent-child (parent always precedes its children in the list)
    for ch, row in zip(chunks, rows):
        if ch.parent_index is not None:
            row.parent_chunk_id = rows[ch.parent_index].id

    # versioning: supersede older current rows for the same citation
    for row in rows:
        supersede_prior(db, domain=domain, new=row, effective=row.effective_date)

    db.commit()
    log.info("indexed %d chunks for document %s", len(rows), document.id)
    return len(rows)
