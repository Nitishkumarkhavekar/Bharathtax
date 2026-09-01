"""Ruling watchlist — the "fresh law for you" feed.

The daily hook that a generic chatbot structurally can't offer: BharatTax knows
the sections THIS officer works on and surfaces newly-ingested case law on those
sections, unprompted.

Two steps, both cheap enough to run on demand (no new table, no background job):

  1. `infer_user_sections` — read the officer's OWN footprint (chat questions,
     appeal/assessment cases, deadlines/demands/notes) and derive the
     Income-tax Act sections they actually deal with. No survey, no setup. When
     there's no footprint yet (a brand-new account), fall back to the sections
     that define their FUNCTION (wing), so the feed is useful from day one.

  2. `fresh_ruling_alerts` — match those sections against `CorpusDocument`
     judgments (GIN-indexed `sections_cited`), newest arrivals first, and flag
     the genuinely fresh ones. Only judgments with a real headnote (`digest`)
     are shown, so every row says what the case held.

Everything is scoped to one user; nothing is written back.
"""
from __future__ import annotations

import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.ingestion.parse.section_cites import _norm, extract_sections
from app.models.appeal import AppealCase
from app.models.assessment import AssessmentCase
from app.models.chat import ChatMessage
from app.models.corpus import CorpusDocument
from app.models.library import SavedItem
from app.models.workspace import Deadline, Demand, StickyNote
from app.core.profiles import WORKSPACE_PROFILE_KEYS

# A judgment counts as "fresh" (worth a NEW badge) if we ingested it within this
# many days. Tunable without a redeploy.
FRESH_DAYS = int(os.getenv("WATCHLIST_FRESH_DAYS", "30"))
# How many source rows we scan / sections we track — kept small so the whole
# thing stays a couple of indexed queries.
_CHAT_SCAN = 300
_MAX_SECTIONS = 12
# digest sentinels that mean "processed, nothing useful held" — never surface these.
_DIGEST_SENTINELS = ("PROCEDURAL", "INSUFFICIENT")

# The sections that DEFINE each function — the fallback when an officer has no
# footprint yet, so the feed is personalised-by-role from the first login.
# Sourced from the canonical department taxonomy (one source of truth) so it
# covers every wing, including the ones the flat model was missing.
from app.core.department import WINGS as _WINGS

WING_DEFAULT_SECTIONS: dict[str, list[str]] = {
    w["key"]: list(w.get("sections") or []) for w in _WINGS
}

# strip subsection parentheticals so "271(1)(c)/40(a)(ia)" -> "271 / 40"
_PARENS = re.compile(r"\([^)]*\)")
_FIELD_TOK = re.compile(r"\d{1,3}-?[A-Za-z]{0,3}")


def _sections_from_field(raw: str | None) -> list[str]:
    """Normalise a short, curated section field ('143(3)/147', 'Sec. 249',
    '80-IB') into top-level tokens ['143','147'] / ['249'] / ['80IB'].

    Different from :func:`extract_sections` (which needs a citation trigger like
    'u/s') — these fields ARE the section, just loosely formatted, so we drop
    subsection parens and read every remaining section-like token."""
    if not raw:
        return []
    cleaned = _PARENS.sub(" ", raw)
    out: list[str] = []
    for m in _FIELD_TOK.finditer(cleaned):
        n = _norm(m.group())
        if n:
            out.append(n)
    return out


def resolved_wing(user) -> str | None:
    """The user's single function key, for the role-default fallback. None when
    they run in 'all' mode or haven't chosen (→ no wing default)."""
    p = getattr(user, "workspace_profile", None)
    if p in WORKSPACE_PROFILE_KEYS:
        return p
    if p == "custom":
        for k in (getattr(user, "workspace_wings", None) or []):
            if k in WORKSPACE_PROFILE_KEYS:
                return k
    return None


def infer_user_sections(db: Session, user, *, limit: int = _MAX_SECTIONS) -> dict:
    """Derive the sections an officer works on from their own footprint.

    Returns ``{"sections": [...], "source": "usage"|"function"|"none"}``.
    Weights: a drafted case (3) > a docket deadline/demand (2) > a note (1) and
    each time they asked about a section in chat (1). Falls back to the wing's
    defining sections when there's no footprint at all."""
    uid = user.id
    weights: Counter[str] = Counter()

    # 1. chat questions the officer typed — the richest signal of what's on their plate.
    for content in db.scalars(
        select(ChatMessage.content)
        .where(ChatMessage.user_id == uid, ChatMessage.role == "user")
        .order_by(desc(ChatMessage.created_at))
        .limit(_CHAT_SCAN)
    ):
        for s in extract_sections(content or ""):
            weights[s] += 1

    # 2. cases they actually drafted — the strongest signal of a live matter.
    for sec in db.scalars(
        select(AppealCase.section).where(
            AppealCase.owner_user_id == uid, AppealCase.section.isnot(None))
    ):
        for s in _sections_from_field(sec):
            weights[s] += 3
    for sec in db.scalars(
        select(AssessmentCase.section).where(
            AssessmentCase.owner_user_id == uid, AssessmentCase.section.isnot(None))
    ):
        for s in _sections_from_field(sec):
            weights[s] += 3

    # 3. docket signals — deadlines / demands (2), notes (1).
    for sec in db.scalars(
        select(Deadline.section_ref).where(
            Deadline.user_id == uid, Deadline.section_ref.isnot(None))
    ):
        for s in _sections_from_field(sec):
            weights[s] += 2
    for sec in db.scalars(
        select(Demand.section).where(
            Demand.user_id == uid, Demand.section.isnot(None))
    ):
        for s in _sections_from_field(sec):
            weights[s] += 2
    for sec in db.scalars(
        select(StickyNote.section_ref).where(
            StickyNote.user_id == uid, StickyNote.section_ref.isnot(None))
    ):
        for s in _sections_from_field(sec):
            weights[s] += 1

    # 4. rulings the officer saved to their Library — an explicit "this matters
    # to me" signal; use the sections we already stamped on the saved item.
    for secs in db.scalars(
        select(SavedItem.sections).where(
            SavedItem.user_id == uid, SavedItem.kind == "ruling",
            SavedItem.sections.isnot(None))
    ):
        for s in (secs or []):
            weights[s] += 2

    if weights:
        top = [s for s, _ in weights.most_common(limit)]
        return {"sections": top, "source": "usage"}

    wing = resolved_wing(user)
    if wing and WING_DEFAULT_SECTIONS.get(wing):
        return {"sections": WING_DEFAULT_SECTIONS[wing][:limit], "source": "function"}
    return {"sections": [], "source": "none"}


def fresh_ruling_alerts(db: Session, sections: list[str], *, limit: int = 6) -> list[dict]:
    """Judgments citing any of ``sections``, newest arrivals first. Only rulings
    with a real headnote are returned; each is flagged ``fresh`` when we ingested
    it within :data:`FRESH_DAYS`. De-duplicated by title."""
    if not sections:
        return []
    want = set(sections)
    fresh_cutoff = datetime.now(timezone.utc) - timedelta(days=FRESH_DAYS)

    rows = db.scalars(
        select(CorpusDocument)
        .where(
            CorpusDocument.doc_type == "judgment",
            CorpusDocument.sections_cited.op("&&")(sections),
            CorpusDocument.digest.isnot(None),
            CorpusDocument.digest.notin_(_DIGEST_SENTINELS),
        )
        .order_by(desc(CorpusDocument.fetched_at), desc(CorpusDocument.id))
        .limit(limit * 4)  # over-fetch so dedup still leaves a full list
    ).all()

    out: list[dict] = []
    seen: set[str] = set()
    for r in rows:
        key = (r.title or "").strip().lower()
        if not key or key in seen:
            continue
        digest = (r.digest or "").strip()
        if not digest or digest in _DIGEST_SENTINELS:
            continue
        seen.add(key)
        matched = [s for s in (r.sections_cited or []) if s in want]
        fresh = bool(r.fetched_at and r.fetched_at >= fresh_cutoff)
        out.append({
            "id": r.id,
            "title": r.title,
            "digest": digest,
            "source_url": r.source_url,
            "matched": matched,
            "date": (r.published_date.isoformat() if r.published_date
                     else (r.fetched_at.date().isoformat() if r.fetched_at else None)),
            "fresh": fresh,
        })
        if len(out) >= limit:
            break
    return out


def ruling_alerts_for_user(db: Session, user, *, limit: int = 6) -> dict:
    """The full payload for the "fresh law for you" card: the sections we're
    watching for this officer, how we chose them, the matching rulings, and how
    many are genuinely fresh."""
    inferred = infer_user_sections(db, user)
    items = fresh_ruling_alerts(db, inferred["sections"], limit=limit)
    return {
        "sections": inferred["sections"],
        "source": inferred["source"],
        "items": items,
        "fresh_count": sum(1 for i in items if i["fresh"]),
    }
