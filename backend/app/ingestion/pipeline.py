"""Workstream B orchestrator + CLI.

Per source:  fetch -> store raw (MinIO) -> extract -> normalise -> parse legal
structure -> structure-aware chunk -> persist CorpusDocument (raw key + clean
text) -> embed + index (pgvector + tsvector).

Re-runnable and idempotent: a fetched item whose checksum already exists as a
CorpusDocument is skipped (this is also how the incremental delta job works).

CLI:
  python -m app.ingestion.pipeline run            # all enabled sources
  python -m app.ingestion.pipeline run --source it_act_1961
  python -m app.ingestion.pipeline verify         # assert corpus + indexes exist
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, select, text as sqltext

from app.core.db import SessionLocal
from app.core.enums import CorpusDocStatus, Domain, SourceType
from app.core.logging import configure_logging, get_logger
from app.ingestion import embed_index, registry
from app.ingestion.chunk import chunk_units
from app.ingestion.contracts import FetchedItem
from app.ingestion.extract import extract_text
from app.ingestion.fetch import get_fetcher
from app.ingestion.parse import get_parser
from app.ingestion.parse.cleaning import normalise
from app.models.corpus import CorpusChunk, CorpusDocument
from app.services import storage

log = get_logger(__name__)


def _existing_doc(db, checksum: str) -> CorpusDocument | None:
    return db.scalar(select(CorpusDocument).where(CorpusDocument.checksum == checksum))


def _process_item(db, *, item: FetchedItem, source: dict, source_id: int, domain: Domain) -> int:
    # Resume-safe dedup: a fully-indexed doc is skipped; a partially-ingested one
    # (e.g. a run interrupted by sleep) resumes from where it stopped.
    existing = _existing_doc(db, item.checksum) if item.checksum else None
    if existing and existing.status == CorpusDocStatus.indexed:
        log.info("skip (already indexed): %s", item.title)
        return 0

    # extract -> normalise legal text (needed for both fresh + resume)
    raw_text = extract_text(item.raw_bytes, item.content_type, filename=item.origin_path or "")
    drop_headers = tuple(h.upper() for h in source.get("drop_headers", []))
    clean = normalise(raw_text, drop_headers=drop_headers)

    if existing:
        doc = existing
        resume_from = db.scalar(
            select(func.count()).select_from(CorpusChunk).where(
                CorpusChunk.corpus_document_id == doc.id
            )
        ) or 0
    else:
        # keep the raw file in MinIO, then persist the document (raw + clean text)
        ext = ".pdf" if "pdf" in item.content_type else ".bin"
        raw_key = f"{item.source_key}/{item.checksum}{ext}"
        storage.put_bytes(raw_key, item.raw_bytes, item.content_type)
        doc = CorpusDocument(
            source_id=source_id, title=item.title, doc_type=item.doc_type,
            source_url=item.source_url, raw_minio_key=raw_key, extracted_text=clean,
            checksum=item.checksum, published_date=item.published_date,
            status=CorpusDocStatus.parsed,
        )
        db.add(doc)
        db.flush()
        resume_from = 0

    # parse -> chunk -> embed + index (resuming if partial)
    chunks = chunk_units(get_parser(source["parser"])(clean))
    n = embed_index.index_document(
        db, document=doc, source_id=source_id, domain=domain, chunks=chunks,
        resume_from=resume_from,
    )
    doc.status = CorpusDocStatus.indexed
    db.commit()
    log.info("ingested '%s': %d chunks (resumed from %d)", item.title, n, resume_from)
    return n


def run(only_source: str | None = None) -> None:
    configure_logging()
    storage.ensure_bucket()
    db = SessionLocal()
    try:
        total = 0
        for source, row in registry.sync_sources(db):
            if only_source and source["key"] != only_source:
                continue
            log.info("=== source: %s (%s) ===", source["key"], source["fetcher"])
            fetcher = get_fetcher(source["fetcher"])
            domain = Domain(source["domain"])
            for item in fetcher(source):
                total += _process_item(db, item=item, source=source, source_id=row.id, domain=domain)
        log.info("DONE. total chunks indexed this run: %d", total)
    finally:
        db.close()


def verify() -> int:
    """Assert the corpus + its indexes exist. Returns process exit code."""
    configure_logging()
    db = SessionLocal()
    ok = True
    try:
        n_sources = db.scalar(select(func.count()).select_from(registry.CorpusSource))
        n_docs = db.scalar(select(func.count()).select_from(CorpusDocument))
        n_chunks = db.scalar(select(func.count()).select_from(CorpusChunk))
        n_embedded = db.scalar(
            select(func.count()).select_from(CorpusChunk).where(CorpusChunk.embedding.isnot(None))
        )
        n_tsv = db.scalar(
            select(func.count()).select_from(CorpusChunk).where(CorpusChunk.tsv.isnot(None))
        )
        by_domain = db.execute(
            select(CorpusChunk.domain, func.count()).group_by(CorpusChunk.domain)
        ).all()
        indexes = db.execute(
            sqltext(
                "SELECT indexname FROM pg_indexes WHERE tablename='corpus_chunks' "
                "AND indexname IN ('ix_corpus_chunks_embedding_hnsw','ix_corpus_chunks_tsv_gin')"
            )
        ).scalars().all()

        print(f"sources           : {n_sources}")
        print(f"corpus_documents  : {n_docs}")
        print(f"corpus_chunks     : {n_chunks}")
        print(f"  with embedding  : {n_embedded}")
        print(f"  with tsvector   : {n_tsv}")
        print(f"  by domain       : {dict(by_domain)}")
        print(f"special indexes   : {sorted(indexes)}")

        checks = {
            "has chunks": (n_chunks or 0) > 0,
            "all chunks embedded": n_chunks == n_embedded,
            "all chunks have tsv": n_chunks == n_tsv,
            "HNSW index present": "ix_corpus_chunks_embedding_hnsw" in indexes,
            "GIN index present": "ix_corpus_chunks_tsv_gin" in indexes,
        }
        for name, passed in checks.items():
            print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
            ok = ok and passed
    finally:
        db.close()
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bharathtax-ingest")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run the ingestion pipeline")
    r.add_argument("--source", help="only this source key")
    sub.add_parser("verify", help="verify corpus + indexes exist")
    args = p.parse_args(argv)

    if args.cmd == "run":
        run(args.source)
        return 0
    if args.cmd == "verify":
        return verify()
    return 2


if __name__ == "__main__":
    sys.exit(main())
