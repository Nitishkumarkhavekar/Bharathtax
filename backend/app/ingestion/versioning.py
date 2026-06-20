"""Effective-date versioning for corpus chunks.

Amendments are ADDED, never overwritten, so we can answer "as the law stood in
AY 2022-23". When a new version of the same citation (domain + section/rule +
sub-unit) is ingested with a newer effective_date, the prior current row is
marked superseded; the new row becomes current. Superseded text is retained.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.enums import Domain
from app.models.corpus import CorpusChunk


def citation_key(c: CorpusChunk) -> tuple:
    """Identity of a legal unit across versions (NOT including effective_date)."""
    return (
        c.domain,
        c.section_number,
        c.rule_number,
        c.subsection,
        c.proviso_no,
        c.explanation_no,
    )


def supersede_prior(
    db: Session, *, domain: Domain, new: CorpusChunk, effective: date | None
) -> None:
    """If `new` has an effective_date newer than an existing current row for the
    same citation, mark the old one superseded and bump the new version number."""
    if effective is None:
        return
    existing = db.scalars(
        select(CorpusChunk).where(
            CorpusChunk.domain == domain,
            CorpusChunk.is_current.is_(True),
            CorpusChunk.section_number == new.section_number,
            CorpusChunk.rule_number == new.rule_number,
            CorpusChunk.subsection == new.subsection,
            CorpusChunk.proviso_no == new.proviso_no,
            CorpusChunk.explanation_no == new.explanation_no,
        )
    ).all()
    for old in existing:
        if old.id == new.id:
            continue
        if old.effective_date is None or old.effective_date < effective:
            old.is_current = False
            old.superseded_date = effective
            new.version = max(new.version, old.version + 1)
            new.supersedes_id = old.id
