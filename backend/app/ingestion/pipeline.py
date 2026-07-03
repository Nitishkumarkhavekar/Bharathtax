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
import contextlib
import signal
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


_EXTRACT_TIMEOUT_S = 90  # a single doc's extraction must not stall the whole run


@contextlib.contextmanager
def _time_limit(seconds: int):
    """Hard wall-clock cap via SIGALRM (Unix, main thread). A malformed PDF can send
    PyMuPDF into a CPU-bound loop that try/except can't catch; this raises TimeoutError
    at the next interpreter check so the run loop can skip that one document."""
    def _raise(signum, frame):
        raise TimeoutError(f"extraction exceeded {seconds}s")
    if hasattr(signal, "SIGALRM"):
        old = signal.signal(signal.SIGALRM, _raise)
        signal.alarm(seconds)
        try:
            yield
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old)
    else:  # non-Unix fallback: no hard cap available
        yield


def _existing_doc(db, checksum: str) -> CorpusDocument | None:
    return db.scalar(select(CorpusDocument).where(CorpusDocument.checksum == checksum))


def _process_item(db, *, item: FetchedItem, source: dict, source_id: int, domain: Domain,
                  embed_vectors: bool = True) -> int:
    # Resume-safe dedup: a fully-indexed doc is skipped; a partially-ingested one
    # (e.g. a run interrupted by sleep) resumes from where it stopped.
    existing = _existing_doc(db, item.checksum) if item.checksum else None
    if existing and existing.status == CorpusDocStatus.indexed:
        log.info("skip (already indexed): %s", item.title)
        return 0
    # In stage-only (no-embed) mode a doc stays `parsed`; if it's already been
    # staged (chunks present, still parsed), skip re-parsing — embed-pending fills it.
    if existing and not embed_vectors and existing.status == CorpusDocStatus.parsed and \
            db.scalar(select(func.count()).select_from(CorpusChunk)
                      .where(CorpusChunk.corpus_document_id == existing.id)):
        log.info("skip (already staged): %s", item.title)
        return 0

    # extract -> normalise legal text (needed for both fresh + resume). A hard
    # timeout guards against a malformed PDF spinning PyMuPDF forever.
    with _time_limit(_EXTRACT_TIMEOUT_S):
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

    # parse -> chunk -> embed + index (resuming if partial). In stage-only mode we
    # persist chunks with NULL embeddings and leave the doc `parsed` for embed-pending.
    chunks = chunk_units(get_parser(source["parser"])(clean))
    n = embed_index.index_document(
        db, document=doc, source_id=source_id, domain=domain, chunks=chunks,
        resume_from=resume_from, embed_vectors=embed_vectors,
    )
    doc.status = CorpusDocStatus.indexed if embed_vectors else CorpusDocStatus.parsed
    db.commit()
    verb = "ingested" if embed_vectors else "staged"
    log.info("%s '%s': %d chunks (resumed from %d)", verb, item.title, n, resume_from)
    return n


def run(only_source: str | None = None, *, no_embed: bool = False,
        shard: tuple[int, int] | None = None) -> None:
    configure_logging()
    storage.ensure_bucket()
    db = SessionLocal()
    try:
        total = 0
        for source, row in registry.sync_sources(db):
            if only_source and source["key"] != only_source:
                continue
            if shard:
                source = {**source, "_shard": shard}
            log.info("=== source: %s (%s)%s%s ===", source["key"], source["fetcher"],
                     " [stage-only]" if no_embed else "",
                     f" [shard {shard[0]}/{shard[1]}]" if shard else "")
            fetcher = get_fetcher(source["fetcher"])
            domain = Domain(source["domain"])
            failed = 0
            for item in fetcher(source):
                try:
                    total += _process_item(db, item=item, source=source, source_id=row.id,
                                           domain=domain, embed_vectors=not no_embed)
                except Exception as e:
                    # One bad doc (corrupt PDF, OCR crash, ...) must not abort the run.
                    db.rollback()
                    failed += 1
                    log.warning("skip (failed): %s -> %s", item.title, str(e)[:150])
            if failed:
                log.warning("source %s: %d doc(s) skipped after errors", source["key"], failed)
        verb = "staged" if no_embed else "indexed"
        log.info("DONE. total chunks %s this run: %d", verb, total)
    finally:
        db.close()


def embed_pending(batch: int = 256) -> None:
    """GPU batch pass: embed every chunk staged with a NULL embedding (from a prior
    `run --no-embed`), then flip fully-embedded documents to `indexed`. Idempotent
    and resumable — safe to re-run after an interruption."""
    configure_logging()
    db = SessionLocal()
    try:
        from app.services import embeddings as emb
        pending_total = db.scalar(
            select(func.count()).select_from(CorpusChunk).where(CorpusChunk.embedding.is_(None))
        ) or 0
        log.info("embed-pending: %d chunk(s) awaiting embedding", pending_total)
        done = 0
        while True:
            rows = db.scalars(
                select(CorpusChunk).where(CorpusChunk.embedding.is_(None))
                .order_by(CorpusChunk.id).limit(batch)
            ).all()
            if not rows:
                break
            for r, vec in zip(rows, emb.embed([r.text for r in rows])):
                r.embedding = vec
            db.commit()
            done += len(rows)
            log.info("  embedded %d/%d", done, pending_total)
        # promote docs whose chunks are now all embedded
        stale = db.scalars(
            select(CorpusDocument).where(CorpusDocument.status == CorpusDocStatus.parsed)
        ).all()
        promoted = 0
        for doc in stale:
            unembedded = db.scalar(
                select(func.count()).select_from(CorpusChunk).where(
                    CorpusChunk.corpus_document_id == doc.id, CorpusChunk.embedding.is_(None))
            ) or 0
            has_chunks = db.scalar(
                select(func.count()).select_from(CorpusChunk).where(
                    CorpusChunk.corpus_document_id == doc.id)
            ) or 0
            if has_chunks and unembedded == 0:
                doc.status = CorpusDocStatus.indexed
                promoted += 1
        db.commit()
        log.info("DONE. embedded %d chunk(s); promoted %d doc(s) -> indexed", done, promoted)
    finally:
        db.close()


def backfill_section_cites(batch: int = 2000) -> None:
    """Fill corpus_documents.sections_cited (top-level IT-Act sections each judgment /
    circular / notification CITES) — powers 'every case on Section 68'. Idempotent +
    resumable: only rows where sections_cited IS NULL, and sets [] when a doc cites
    nothing, so a re-run after a freshness pass processes only newly-ingested docs."""
    configure_logging()
    from app.ingestion.parse.section_cites import extract_sections
    db = SessionLocal()
    try:
        cited_types = (SourceType.judgment, SourceType.circular, SourceType.notification)
        total = withsecs = 0
        while True:
            rows = db.scalars(
                select(CorpusDocument).where(
                    CorpusDocument.sections_cited.is_(None),
                    CorpusDocument.extracted_text.isnot(None),
                    CorpusDocument.doc_type.in_(cited_types),
                ).order_by(CorpusDocument.id).limit(batch)
            ).all()
            if not rows:
                break
            for doc in rows:
                secs = extract_sections(doc.extracted_text or "")
                doc.sections_cited = secs
                total += 1
                if secs:
                    withsecs += 1
            db.commit()
            log.info("  backfilled %d docs (%d cite >=1 section)", total, withsecs)
        log.info("DONE. sections_cited backfilled for %d docs; %d cite >=1 section", total, withsecs)
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
    r.add_argument("--no-embed", action="store_true",
                   help="stage-only: parse+chunk on CPU, leave embeddings NULL for embed-pending (GPU)")
    r.add_argument("--shard", help="modulo shard 'i/N' for parallel staging (e.g. 0/4)")
    ep = sub.add_parser("embed-pending", help="GPU pass: embed all NULL-embedding chunks")
    ep.add_argument("--batch", type=int, default=256)
    bc = sub.add_parser("backfill-cites", help="fill sections_cited (every-case-on-section-X)")
    bc.add_argument("--batch", type=int, default=2000)
    sub.add_parser("verify", help="verify corpus + indexes exist")
    args = p.parse_args(argv)

    if args.cmd == "run":
        shard = None
        if args.shard:
            i, n = (int(x) for x in args.shard.split("/"))
            shard = (i, n)
        run(args.source, no_embed=args.no_embed, shard=shard)
        return 0
    if args.cmd == "embed-pending":
        embed_pending(batch=args.batch)
        return 0
    if args.cmd == "backfill-cites":
        backfill_section_cites(batch=args.batch)
        return 0
    if args.cmd == "verify":
        return verify()
    return 2


if __name__ == "__main__":
    sys.exit(main())
