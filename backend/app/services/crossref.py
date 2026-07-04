"""Cross-references — the "section hub". Given an Income-tax Act section, link across
the corpus: the statutory text (the section itself), the CBDT circulars/notifications
that clarify it, and the leading judgments that interpret it (with their headnotes).

Built on the #9 sections_cited data (doc-level, GIN-indexed) for circulars/cases and
the section_number index for the statute. Rules aren't linked in v1 — rule text rarely
names the section literally, so a reliable rule<->section map needs its own pass.
"""
from __future__ import annotations

import re

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.enums import ChunkLevel, SourceType
from app.models.corpus import CorpusChunk, CorpusDocument

_SEC = re.compile(r"\s*(?:u/s\.?|s\.?|sec\.?|section)?\s*(\d{1,3})-?([A-Za-z]{0,3})", re.I)


def _norm_section(s: str) -> str | None:
    m = _SEC.match(s or "")
    if not m:
        return None
    n = int(m.group(1))
    if n < 1 or n > 300:
        return None
    return f"{n}{m.group(2).upper()}"


def cross_references(db: Session, section: str, *, case_limit: int = 10,
                     comm_limit: int = 10) -> dict:
    sec = _norm_section(section)
    if not sec:
        return {"section": section, "error": "unrecognised section", "statute": [],
                "circulars": [], "cases": [], "counts": {}}
    arr = [sec]

    # 1) the statute — section-level act chunks (1961 + 2025 Income-tax Acts)
    st = db.execute(
        select(CorpusChunk).where(
            CorpusChunk.section_number == sec,
            CorpusChunk.act_name.ilike("%income%tax act%"),
            CorpusChunk.chunk_level == ChunkLevel.section,
            CorpusChunk.is_current.is_(True),
        ).limit(4)
    ).scalars().all()
    statute = [{"act": c.act_name, "breadcrumb": c.breadcrumb,
                "text": (c.text or "")[:1500], "chunk_id": c.id} for c in st]

    # 2) circulars / notifications that cite the section (most recent first)
    circ = db.execute(
        select(CorpusDocument).where(
            CorpusDocument.doc_type.in_((SourceType.circular, SourceType.notification)),
            CorpusDocument.sections_cited.op("&&")(arr),
        ).order_by(CorpusDocument.published_date.desc().nullslast(),
                   CorpusDocument.id.desc()).limit(comm_limit)
    ).scalars().all()
    circulars = [{"title": d.title, "doc_type": d.doc_type.value, "doc_id": d.id,
                  "source_url": d.source_url,
                  "date": str(d.published_date) if d.published_date else None} for d in circ]

    # 3) judgments that interpret the section — substantive headnotes first
    base = select(CorpusDocument).where(
        CorpusDocument.doc_type == SourceType.judgment,
        CorpusDocument.sections_cited.op("&&")(arr),
    )
    total_cases = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    dig_rank = case((CorpusDocument.digest.is_(None), 2),
                    (CorpusDocument.digest.in_(("PROCEDURAL", "INSUFFICIENT")), 1),
                    else_=0)
    case_rows = db.execute(
        base.order_by(dig_rank.asc(), CorpusDocument.id.desc()).limit(case_limit)
    ).scalars().all()
    cases = []
    for d in case_rows:
        dg = d.digest if d.digest and d.digest not in ("PROCEDURAL", "INSUFFICIENT") else None
        cases.append({"title": d.title, "doc_id": d.id, "source_url": d.source_url,
                      "digest": dg, "sections_cited": d.sections_cited})

    return {
        "section": sec,
        "statute": statute,
        "circulars": circulars,
        "cases": cases,
        "counts": {"circulars": len(circulars), "cases_shown": len(cases),
                   "cases_total": total_cases},
    }
