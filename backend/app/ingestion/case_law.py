"""Ingest income-tax judgments (ITAT / HC / SC) into the corpus under
domain=case_law, so the Ask Bot and the appeal drafter can cite real case law.

Judgments lack Act-style structure, so we chunk generically by paragraph windows
(no parent-child), reusing the existing embed+index path. Drop PDFs under
data/manual/case_law/ and run:  python -m app.ingestion.case_law /data/manual/case_law
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import signal
import sys
from pathlib import Path

_S3 = "https://indian-high-court-judgments.s3.ap-south-1.amazonaws.com"

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.enums import ChunkLevel, CorpusDocStatus, Domain, SourceType
from app.core.logging import get_logger
from app.ingestion.contracts import Chunk
from app.ingestion.embed_index import index_document
from app.ingestion.extract.pdf import extract
from app.models.corpus import CorpusDocument, CorpusSource
from app.services import storage

log = get_logger(__name__)

SOURCE_KEY = "it_caselaw"
_CHUNK_CHARS = 1400
_MIN_CHARS = 80
# Bulk case-law: stage chunks with NULL embedding (CASELAW_NO_EMBED=1) and fill on the
# GPU later — inline CPU embedding of ~500k chunks would take days.
_NO_EMBED = os.getenv("CASELAW_NO_EMBED", "").strip() in ("1", "true", "yes")
_EXTRACT_TIMEOUT_S = 120  # a single malformed PDF must not stall a 50k-doc run


@contextlib.contextmanager
def _time_limit(seconds: int):
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
    else:
        yield


def get_source(db):
    src = db.scalar(select(CorpusSource).where(CorpusSource.key == SOURCE_KEY))
    if not src:
        src = CorpusSource(key=SOURCE_KEY, domain=Domain.case_law,
                           name="Income-tax case law (ITAT / HC / SC)",
                           source_type=SourceType.judgment, config={})
        db.add(src)
        db.commit()
        db.refresh(src)
    return src


def _chunks(title: str, text: str) -> list[Chunk]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: list[Chunk] = []
    buf = ""

    def flush(b: str):
        body = b.strip()
        if len(body) >= _MIN_CHARS:
            out.append(Chunk(text=f"{title}\n{body}", body=body, breadcrumb=title, level=ChunkLevel.section))

    for p in paras:
        if buf and len(buf) + len(p) > _CHUNK_CHARS:
            flush(buf)
            buf = p
        else:
            buf = f"{buf}\n\n{p}".strip()
    flush(buf)
    return out


def _content_hash(text: str) -> str:
    """Hash NORMALISED text, not raw bytes. The HC-judgments dataset serves the
    same connected-matters order ('@ Ors') under many CNRs, each a byte-different
    PDF (regenerated with a new timestamp) — byte-checksum dedup misses those, so
    one order would be ingested dozens of times. Content-hash collapses them."""
    return hashlib.sha256(re.sub(r"\s+", " ", text).strip().lower().encode("utf-8")).hexdigest()


def ingest_pdf(db, src, raw: bytes, title: str, source_url: str | None = None) -> int:
    with _time_limit(_EXTRACT_TIMEOUT_S):
        text = extract(raw)
    text = text.replace("\x00", "")   # PostgreSQL text can't store NUL bytes
    if not text.strip():
        return 0
    checksum = _content_hash(text)
    if db.scalar(select(CorpusDocument).where(CorpusDocument.checksum == checksum,
                                              CorpusDocument.source_id == src.id)):
        return 0  # same judgment text already ingested (connected matter / duplicate)
    key = f"case_law/{checksum[:16]}.pdf"
    storage.put_bytes(key, raw, "application/pdf")
    status = CorpusDocStatus.parsed if _NO_EMBED else CorpusDocStatus.indexed
    doc = CorpusDocument(source_id=src.id, title=title, doc_type=SourceType.judgment,
                         source_url=source_url, raw_minio_key=key, extracted_text=text,
                         checksum=checksum, status=status)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return index_document(db, document=doc, source_id=src.id, domain=Domain.case_law,
                          chunks=_chunks(title, text), embed_vectors=not _NO_EMBED)


def _load_manifest(path: str) -> dict:
    """Optional manifest.jsonl in the dir: maps fname -> {title, court_name, pdf_key, ...}
    (e.g. the AWS Open-Data acquisition manifest) so judgments get proper case titles."""
    man: dict = {}
    f = Path(path) / "manifest.jsonl"
    if f.exists():
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    r = json.loads(line)
                    if r.get("fname"):
                        man[r["fname"]] = r
                except json.JSONDecodeError:
                    pass
    return man


def ingest_dir(path: str) -> dict:
    db = SessionLocal()
    try:
        src = get_source(db)
        man = _load_manifest(path)
        docs = sorted(Path(path).glob("**/*.pdf"))
        total = failed = done = 0
        verb = "staged" if _NO_EMBED else "ingested"
        for pdf in docs:
            meta = man.get(pdf.name, {})
            title = (meta.get("title") or pdf.stem.replace("_", " "))[:300]
            url = f"{_S3}/{meta['pdf_key']}" if meta.get("pdf_key") else None
            try:
                total += ingest_pdf(db, src, pdf.read_bytes(), title, source_url=url)
            except Exception as e:
                # a corrupt/hanging PDF (timeout) must not abort a 50k-doc run
                db.rollback()
                failed += 1
                log.warning("skip (failed): %s -> %s", pdf.name, str(e)[:120])
            done += 1
            if done % 500 == 0:
                log.info("%s %d/%d docs | %d chunks | %d failed", verb, done, len(docs), total, failed)
        log.info("DONE. %s %d docs, %d chunks, %d failed", verb, len(docs), total, failed)
        return {"files": len(docs), "chunks": total, "failed": failed}
    finally:
        db.close()


if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else "/data/manual/case_law"
    print("case_law ingest:", ingest_dir(d))
