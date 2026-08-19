"""Rulings explorer: semantic search over the case-law corpus (domain=case_law).
Taxsutra-style judgment search, grounded in the ingested judgments.

Two data sources coexist here — deliberately kept independent:

* ``/rulings``          → IndianKanoon-backed corpus we've ingested (dense +
                          sparse retrieval, section-aware boost).
* ``/rulings/browse``   → our own DB, paginated newest-first.
* ``/rulings/ecourts/*``→ eCourts India partner API (live court data,
                          CNR-based lookup, fielded search with facets).

The eCourts routes NEVER call the IndianKanoon / dense-retrieval stack.
Adding eCourts is purely additive so we can turn it off (empty env key)
without regressing the existing search.
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import String, and_, cast, desc, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, client_meta, get_principal
from app.core.db import get_db
from app.core.enums import Domain
from app.models.corpus import CorpusDocument
from app.services import audit
from app.services import ecourts as _ecourts
from app.services.retrieval import retrieve

router = APIRouter(prefix="/rulings", tags=["rulings"])


# ITAT city benches — feeds the Browse-tab bench dropdown. Kept here so the
# frontend can fetch it from the API rather than duplicating the list.
BENCHES = [
    "Agra", "Ahmedabad", "Allahabad", "Amritsar", "Bangalore", "Chandigarh",
    "Chennai", "Cochin", "Cuttack", "Delhi", "Guwahati", "Hyderabad",
    "Indore", "Jabalpur", "Jaipur", "Jodhpur", "Kolkata", "Lucknow",
    "Mumbai", "Nagpur", "Panaji", "Patna", "Pune", "Raipur", "Rajkot",
    "Ranchi", "Surat", "Visakhapatnam",
]


# Cache the full envelope (items + total) — earlier bug: total was stored
# on items[0] and popped on read, so warm hits got total=0.
_SEARCH_ECOURTS_CACHE: dict[str, tuple[float, dict]] = {}
_SEARCH_ECOURTS_TTL_S = 300.0  # 5 min


def _ecourts_case_url(cnr: str | None) -> str | None:
    """Public URL for a given CNR — intentionally returns None.

    There is no public, captcha-free URL for an individual eCourts case:
      * ``https://ecourtsindia.com/case/{cnr}`` (third-party wrapper) 404s.
      * ``https://services.ecourts.gov.in/ecourtindia_v6/?...&cino={cnr}``
        loads the CNR search page but returns "Invalid Captcha" until the
        user solves an in-page challenge, so a plain link is misleading.

    The frontend renders case detail INLINE via the partner-API endpoint
    (``/rulings/ecourts/case/{cnr}``) instead of linking out. We keep this
    helper so callers stay symmetrical and so future consumers get a
    single, documented place to change if a real public URL appears.
    """
    _ = cnr  # kept for signature stability; see docstring.
    return None


def _ecourts_search_cached(q: str, limit: int = 6) -> dict:
    """Free-text eCourts case search, cached per normalised query.

    `query=` is eCourts' real full-text param (verified). Returns the top
    `limit` cases + total-match count, shaped for our /rulings frontend so
    it can render them in a small "Also in eCourts India" strip below the
    local results.

    ~200-400 ms cold, <1 ms warm. Silently returns an empty envelope when
    the integration is disabled or upstream errors — local results always
    render.
    """
    empty = {"items": [], "total": 0}
    if not _ecourts.available() or not q.strip():
        return empty
    key = q.strip().lower()[:256]
    import time
    now = time.time()
    cached = _SEARCH_ECOURTS_CACHE.get(key)
    if cached and (now - cached[0] < _SEARCH_ECOURTS_TTL_S):
        return cached[1]
    try:
        data = _ecourts.get(
            "/api/partner/search",
            params={
                "query": q,
                "hasJudgments": "true",
                "sort": "score",
                "order": "desc",
                "pageSize": limit,
            },
            long=True,
        )
    except _ecourts.EcourtsError:
        return empty
    if not isinstance(data, dict):
        return empty
    items = []
    for it in (data.get("results") or [])[:limit]:
        cnr = it.get("cnr")
        status = it.get("caseStatus") or ""
        items.append({
            "cnr": cnr,
            "title": _format_ecourts_title(it),
            "digest": _format_ecourts_digest(it),
            "source_url": _ecourts_case_url(cnr),
            "decision_date": it.get("decisionDate"),
            "court": it.get("courtName") or it.get("courtCode"),
            "sections_cited": list(it.get("actsAndSections") or []),
            "status": status if status and status != "UNKNOWN" else "",
        })
    payload = {"items": items, "total": int(data.get("totalHits") or 0)}
    _SEARCH_ECOURTS_CACHE[key] = (now, payload)
    return payload


@router.get("")
def search(q: str, request: Request,
           p: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> dict:
    # use_rerank=False — the CPU cross-encoder rerank is ~40 s on a 20-passage
    # candidate set, which is unacceptable for an interactive search box. The
    # dense-score ordering is fine for the current case-law corpus.
    #
    # Fire the local retrieval and the eCourts free-text query in PARALLEL
    # so total latency = max(local, eCourts) instead of sum. Both are usually
    # in the 200-400 ms range, so the combined response lands under a second.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as ex:
        local_fut = ex.submit(retrieve, db, q, domain=Domain.case_law, use_rerank=False)
        ecourts_fut = ex.submit(_ecourts_search_cached, q, 6)
        res = local_fut.result()
        ecourts = ecourts_fut.result()  # {"items": [...], "total": N}

    audit.log_event(db, action="rulings.search", user_id=p.user.id, wing_id=p.user.wing_id,
                    query_text=q, **client_meta(request))
    seen, results = set(), []
    for x in res.passages:
        if x.breadcrumb in seen:
            continue
        seen.add(x.breadcrumb)
        results.append({"breadcrumb": x.breadcrumb, "snippet": x.match_text[:300],
                        "source_url": x.source_url, "score": x.score, "chunk_id": x.chunk_id,
                        "digest": x.digest, "sections_cited": x.sections_cited})
    return {
        "grounded": res.grounded,
        "results": results,
        "meta": res.meta,
        "ecourts": ecourts,
    }


@router.get("/benches")
def list_benches(p: Principal = Depends(get_principal)) -> dict:
    """Return the ITAT bench list for the Browse-tab dropdown."""
    return {"benches": BENCHES}


@router.get("/browse")
def browse_judgments(
    request: Request,
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
    bench: str | None = Query(None, description="ITAT city bench (Delhi, Mumbai, …) or 'All'"),
    judge: str | None = Query(None, description="Free-text judge-name match (title / digest / text)"),
    date_from: date | None = Query(None, description="Only judgments on or after this date"),
    date_to: date | None = Query(None, description="Only judgments on or before this date"),
    page: int = Query(1, ge=1, le=10_000),
    per_page: int = Query(20, ge=1, le=100),
) -> dict:
    """Filtered browse of the case-law corpus. Newest first.

    * bench      — matches judgments whose title (or source URL) mentions the
                   city; typical for ITAT titles like "…on 12 Jan 2023, Pune".
    * judge      — case-insensitive ILIKE on title + digest + a slice of the
                   extracted text. The corpus doesn't yet have a `judges`
                   column so we do a best-effort text match.
    * date_from  — inclusive lower bound on `published_date`.
    * date_to    — inclusive upper bound on `published_date`.
    * page       — 1-based; returns `per_page` items.
    """
    filters = [CorpusDocument.doc_type == "judgment"]

    if bench and bench.strip().lower() != "all":
        b = bench.strip()
        pattern = f"%{b}%"
        filters.append(or_(
            CorpusDocument.title.ilike(pattern),
            CorpusDocument.source_url.ilike(pattern),
        ))
    if judge and judge.strip():
        j = f"%{judge.strip()}%"
        filters.append(or_(
            CorpusDocument.title.ilike(j),
            CorpusDocument.digest.ilike(j),
            # Judge names usually appear in the first ~4KB of the judgment
            # (party header + coram line). Substring the extracted text so
            # we don't scan every megabyte of full judgment prose.
            func.substr(cast(CorpusDocument.extracted_text, String), 1, 4000).ilike(j),
        ))
    if date_from:
        filters.append(CorpusDocument.published_date >= date_from)
    if date_to:
        filters.append(CorpusDocument.published_date <= date_to)

    where = and_(*filters)
    total = int(db.scalar(select(func.count(CorpusDocument.id)).where(where)) or 0)
    total_pages = max(1, (total + per_page - 1) // per_page)
    if page > total_pages:
        page = total_pages
    offset = (page - 1) * per_page

    rows = db.scalars(
        select(CorpusDocument)
        .where(where)
        .order_by(desc(CorpusDocument.published_date), desc(CorpusDocument.id))
        .offset(offset).limit(per_page)
    ).all()

    audit.log_event(
        db, action="rulings.browse", user_id=p.user.id, wing_id=p.user.wing_id,
        query_text=f"bench={bench} judge={judge} from={date_from} to={date_to}",
        **client_meta(request),
    )

    return {
        "items": [
            {
                "id": r.id,
                "title": r.title,
                "digest": r.digest,
                "source_url": r.source_url,
                "sections_cited": list(r.sections_cited or []),
                "published_date": r.published_date.isoformat() if r.published_date else None,
            }
            for r in rows
        ],
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "filters": {
            "bench": bench, "judge": judge,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
        },
    }


# ==========================================================================
# Stats headline — powers the four boxes above the search bar.
# ==========================================================================
# In-memory TTL cache for the eCourts stats query. That endpoint is ~1 s
# and the numbers only move meaningfully day-to-day, so caching for 10 min
# keeps the Case Law landing snappy without burning the eCourts quota.
_STATS_CACHE: dict = {"ts": 0.0, "value": None}
_STATS_TTL_S = 600.0


def _ecourts_stats_cached() -> dict | None:
    """Fetch eCourts totals via /api/partner/search — one request, limit=1,
    all the useful numbers live in the response envelope + facets. Returns
    None when the integration is disabled or the upstream errors, so the
    caller can degrade gracefully."""
    import time
    now = time.time()
    if _STATS_CACHE["value"] and (now - _STATS_CACHE["ts"] < _STATS_TTL_S):
        return _STATS_CACHE["value"]
    if not _ecourts.available():
        return None
    try:
        d = _ecourts.get("/api/partner/search", params={"limit": 1}, long=True)
    except _ecourts.EcourtsError:
        return None
    if not isinstance(d, dict):
        return None

    total = int(d.get("totalHits") or 0)
    facets = d.get("facets") or {}
    # hasJudgments facet → number of cases with a judgment attached.
    has_j_facet = (facets.get("hasJudgments") or {}).get("values") or {}
    judgments = int(has_j_facet.get("true", 0) or has_j_facet.get(True, 0) or 0)
    # courtCode facet → distinct court/bench count.
    court_facet = (facets.get("courtCode") or {}).get("values") or {}
    benches = len(court_facet)
    # decisionYear facet → min/max year range for coverage. Clamp to today
    # so a stray "2099" filing typo doesn't produce a silly "1947–2099" label.
    current_year = datetime.now(timezone.utc).year
    year_facet = (facets.get("decisionYear") or {}).get("values") or {}
    years = sorted(
        int(y) for y in year_facet.keys()
        if isinstance(y, (str, int)) and str(y).isdigit() and 1900 <= int(y) <= current_year
    )
    year_min = years[0] if years else None
    year_max = years[-1] if years else None

    value = {
        "total_cases": total,
        "judgments": judgments,
        "benches": benches,
        "coverage_min_year": year_min,
        "coverage_max_year": year_max,
    }
    _STATS_CACHE["value"] = value
    _STATS_CACHE["ts"] = now
    return value


@router.get("/stats")
def rulings_stats(
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> dict:
    """Aggregate numbers for the Case Law landing.

    When eCourts is wired up (ECOURTS_API_KEY set) the headline numbers come
    from live eCourts data: hundreds of millions of cases, thousands of
    courts, decades of coverage. The local corpus counts are still returned
    under `corpus_*` fields for anyone who wants to show both.
    """
    # Local corpus — always cheap.
    corpus_judgments = int(db.scalar(
        select(func.count(CorpusDocument.id)).where(CorpusDocument.doc_type == "judgment")
    ) or 0)
    appeals_local = 0
    try:
        from app.models.appeal import AppealCase
        appeals_local = int(db.scalar(select(func.count(AppealCase.id))) or 0)
    except Exception:  # noqa: BLE001
        appeals_local = 0

    coverage_row = db.execute(
        select(
            func.min(CorpusDocument.published_date),
            func.max(CorpusDocument.published_date),
        ).where(
            CorpusDocument.doc_type == "judgment",
            CorpusDocument.published_date.is_not(None),
        )
    ).one()
    corpus_min, corpus_max = coverage_row
    corpus_min_year = corpus_min.year if corpus_min else None
    corpus_max_year = corpus_max.year if corpus_max else None

    # eCourts totals (cached).
    ec = _ecourts_stats_cached()

    if ec:
        # Prefer eCourts numbers for the headline. Appeals ≈ total cases
        # since an eCourts "case" IS an appeal/petition in most filings.
        judgments = ec["judgments"] or corpus_judgments
        appeals = ec["total_cases"]
        benches = ec["benches"] or len(BENCHES)
        min_year = ec["coverage_min_year"] or corpus_min_year
        max_year = ec["coverage_max_year"] or corpus_max_year
        source = "ecourts"
    else:
        judgments = corpus_judgments
        appeals = appeals_local or corpus_judgments
        benches = len(BENCHES)
        min_year = corpus_min_year
        max_year = corpus_max_year
        source = "corpus"

    coverage_label = (
        f"{min_year}–{max_year}"  # en-dash
        if min_year and max_year
        else "—"
    )

    return {
        "judgments": judgments,
        "appeals": appeals,
        "benches": benches,
        "coverage_min_year": min_year,
        "coverage_max_year": max_year,
        "coverage_label": coverage_label,
        "source": source,  # "ecourts" | "corpus"
        # Local corpus counts still exposed for anyone who wants both.
        "corpus": {
            "judgments": corpus_judgments,
            "appeals": appeals_local,
            "benches": len(BENCHES),
            "coverage_min_year": corpus_min_year,
            "coverage_max_year": corpus_max_year,
        },
    }


# ==========================================================================
# Popular topics — trending research topics for the Case Law landing chips.
# Grounded in real data when sections_cited is populated; otherwise falls
# back to a deterministic weekly rotation of curated topics so the list
# doesn't feel stale but also doesn't change every page-load.
# ==========================================================================

# Editorial fallback list — used when sections_cited is not yet populated on
# the corpus. Broad enough that any weekly slice looks "trending".
_CURATED_TOPICS: list[dict] = [
    {"topic": "penalty u/s 271", "section": "271", "q": "penalty section 271"},
    {"topic": "capital gains", "section": "45", "q": "capital gains"},
    {"topic": "transfer pricing", "section": "92", "q": "transfer pricing"},
    {"topic": "reassessment u/s 147", "section": "147", "q": "reassessment section 147"},
    {"topic": "section 68", "section": "68", "q": "section 68 unexplained credit"},
    {"topic": "bogus purchases", "section": None, "q": "bogus purchases"},
    {"topic": "depreciation", "section": "32", "q": "depreciation section 32"},
    {"topic": "TDS", "section": "194", "q": "TDS deduction at source"},
    {"topic": "house property", "section": "22", "q": "income from house property"},
    {"topic": "charitable trust", "section": "11", "q": "charitable trust exemption"},
    {"topic": "disallowance", "section": "40", "q": "disallowance section 40"},
    {"topic": "condonation of delay", "section": None, "q": "condonation of delay"},
    {"topic": "section 14A", "section": "14A", "q": "section 14A disallowance"},
    {"topic": "section 56(2)(x)", "section": "56", "q": "section 56 gift immovable property"},
    {"topic": "section 148A safeguards", "section": "148A", "q": "section 148A safeguards"},
    {"topic": "search & seizure", "section": None, "q": "search and seizure"},
    {"topic": "unexplained investment", "section": "69", "q": "unexplained investment section 69"},
    {"topic": "cash deposits demonetisation", "section": None, "q": "cash deposit demonetisation"},
    {"topic": "share application money", "section": "68", "q": "share application money section 68"},
    {"topic": "section 263 revision", "section": "263", "q": "section 263 revision"},
]


def _week_index() -> int:
    """Deterministic per-week rotation index. Same week ⇒ same slice, so
    every visitor in a given week sees the same trending list."""
    now = datetime.now(timezone.utc)
    return int(now.strftime("%V"))  # ISO week number (1..53)


@router.get("/popular-topics")
def popular_topics(
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
    limit: int = Query(12, ge=4, le=30),
) -> dict:
    """Trending research topics. Prefers real citation frequency; falls back
    to a deterministic weekly rotation of curated topics."""
    # 1. Try real data: top sections by citation frequency across corpus.
    try:
        rows = db.execute(
            select(
                func.unnest(CorpusDocument.sections_cited).label("section"),
                func.count().label("c"),
            )
            .where(CorpusDocument.doc_type == "judgment")
            .group_by("section")
            .order_by(desc("c"))
            .limit(limit)
        ).all()
    except Exception:  # noqa: BLE001
        rows = []

    real_topics: list[dict] = []
    for r in rows:
        section = str(r.section or "").strip()
        if not section:
            continue
        real_topics.append({
            "topic": f"section {section}",
            "section": section,
            "q": f"section {section}",
            "count": int(r.c),
            "source": "corpus",
        })

    if len(real_topics) >= limit:
        return {"items": real_topics[:limit], "source": "corpus"}

    # 2. Fallback: deterministic weekly rotation over the curated list.
    n = len(_CURATED_TOPICS)
    start = (_week_index() * 3) % n  # shift by 3 each week
    curated = [_CURATED_TOPICS[(start + i) % n] for i in range(limit)]
    curated_topics = [{**t, "source": "curated"} for t in curated]

    # Merge real + curated, deduped by topic label, respecting the limit.
    seen = {t["topic"].lower() for t in real_topics}
    out = list(real_topics)
    for t in curated_topics:
        if t["topic"].lower() in seen:
            continue
        out.append(t)
        seen.add(t["topic"].lower())
        if len(out) >= limit:
            break
    return {
        "items": out[:limit],
        "source": "corpus" if real_topics else "curated",
        "week": _week_index(),
    }


# ==========================================================================
# Recently pronounced — dates + counts for the date-chip strip.
# Prefers live eCourts numbers so the chip count matches what "By Date"
# will actually show. Falls back to local corpus counts when eCourts is
# disabled or the daily-count fetch fails.
# ==========================================================================
_DATES_CACHE: dict[int, tuple[float, dict]] = {}
_DATES_TTL_S = 300.0  # 5 min


def _ecourts_daily_counts(day_isos: list[str]) -> dict[str, int]:
    """Fire one eCourts search per date IN PARALLEL to get judgment counts.

    eCourts' `decisionDate` facet only groups by YEAR, not day — so daily
    counts need N separate calls. Each is ~200 ms so 6 in parallel via a
    ThreadPoolExecutor gets us the whole strip in ~300 ms.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    out: dict[str, int] = {}

    def _fetch_one(iso: str) -> tuple[str, int]:
        try:
            d = _ecourts.get(
                "/api/partner/search",
                params={
                    "hasJudgments": "true",
                    "decisionDateFrom": iso,
                    "decisionDateTo": iso,
                    "pageSize": 1,
                },
                long=True,
            )
            return iso, int((d or {}).get("totalHits") or 0)
        except Exception:  # noqa: BLE001 — never break the widget on a single-day failure
            return iso, 0

    with ThreadPoolExecutor(max_workers=min(8, len(day_isos))) as ex:
        futs = [ex.submit(_fetch_one, iso) for iso in day_isos]
        for f in as_completed(futs):
            iso, cnt = f.result()
            out[iso] = cnt
    return out


@router.get("/recent-dates")
def recent_dates(
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
    limit: int = Query(11, ge=3, le=30),
) -> dict:
    """Dates on which judgments were pronounced, newest first, with counts.

    Data source:
      * eCourts (live) — one date-filtered search per day, fired in parallel,
        cached 5 min. Guarantees the chip count matches what the By-Date tab
        will show for that same date.
      * Local corpus (fallback) — group-by on `published_date` when eCourts
        is disabled or all daily calls fail.
    """
    import time
    now = time.time()
    cached = _DATES_CACHE.get(limit)
    if cached and (now - cached[0] < _DATES_TTL_S):
        return cached[1]

    if _ecourts.available():
        # Build a rolling window of the last `limit` calendar days,
        # newest first. Only include days that actually have judgments so
        # the strip doesn't show zeroes.
        from datetime import timedelta as _td
        today = datetime.now(timezone.utc).date()
        window = [(today - _td(days=i)).isoformat() for i in range(limit * 2)]
        counts = _ecourts_daily_counts(window)
        # Filter out zero-count days, keep newest-first, cap at `limit`.
        items = [
            {"date": iso, "count": counts[iso]}
            for iso in window
            if counts.get(iso, 0) > 0
        ][:limit]
        if items:
            payload = {"source": "ecourts", "items": items}
            _DATES_CACHE[limit] = (now, payload)
            return payload
        # If eCourts returned no days (all failures / really empty window),
        # fall through to local.

    # Local corpus fallback.
    rows = db.execute(
        select(
            CorpusDocument.published_date.label("d"),
            func.count().label("c"),
        )
        .where(
            CorpusDocument.doc_type == "judgment",
            CorpusDocument.published_date.is_not(None),
        )
        .group_by(CorpusDocument.published_date)
        .order_by(desc(CorpusDocument.published_date))
        .limit(limit)
    ).all()

    source = "published_date"
    if not rows:
        rows = db.execute(
            select(
                func.date(CorpusDocument.fetched_at).label("d"),
                func.count().label("c"),
            )
            .where(
                CorpusDocument.doc_type == "judgment",
                CorpusDocument.fetched_at.is_not(None),
            )
            .group_by(func.date(CorpusDocument.fetched_at))
            .order_by(desc(func.date(CorpusDocument.fetched_at)))
            .limit(limit)
        ).all()
        source = "fetched_at" if rows else "none"

    payload = {
        "source": source,  # "published_date" | "fetched_at" | "none"
        "items": [
            {"date": r.d.isoformat() if r.d else None, "count": int(r.c)}
            for r in rows
        ],
    }
    _DATES_CACHE[limit] = (now, payload)
    return payload


# ==========================================================================
# Recent judgments — the "Recent" list under the search bar. Newest first.
#
# Data source strategy:
#   1. If eCourts is wired up (ECOURTS_API_KEY set), pull the top-N judgments
#      from live eCourts data (sorted decisionDate DESC, hasJudgments=true,
#      decisionDate within the last ~180 days so results stay "recent").
#      That's judgments across every court in India, refreshed constantly.
#   2. If eCourts is disabled or errors, fall back to the local ingested
#      corpus (order by published_date DESC, id DESC) — the platform still
#      works, just with a much smaller catalogue.
#
# Both branches are TTL-cached (5 minutes) so revisiting the Case Law page
# doesn't repeatedly hit eCourts / the DB. Cache key includes the limit so
# distinct callers with different N don't share.
# ==========================================================================
_RECENT_CACHE: dict[int, tuple[float, dict]] = {}
_RECENT_TTL_S = 300.0  # 5 min — recent list only needs to be minute-fresh
def _local_recent(db: Session, limit: int) -> list[dict]:
    rows = db.scalars(
        select(CorpusDocument)
        .where(CorpusDocument.doc_type == "judgment")
        .order_by(
            desc(CorpusDocument.published_date).nulls_last(),
            desc(CorpusDocument.id),
        )
        .limit(limit)
    ).all()
    return [
        {
            "id": r.id,
            "title": r.title,
            "digest": r.digest,
            "source_url": r.source_url,
            "sections_cited": list(r.sections_cited or []),
            "published_date": r.published_date.isoformat() if r.published_date else None,
        }
        for r in rows
    ]


def _format_ecourts_title(it: dict) -> str:
    """Match the eCourts card title we render on the Browse tab so both
    lists look consistent — 'Petitioner vs Respondent — Court · YYYY-MM-DD'."""
    petitioners = it.get("petitioners") or []
    respondents = it.get("respondents") or []
    petitioner = petitioners[0] if petitioners else ""
    respondent = respondents[0] if respondents else ""
    parties = (
        f"{petitioner} vs {respondent}"
        if petitioner and respondent
        else (petitioner or respondent or "(unnamed parties)")
    )
    court = it.get("courtName") or it.get("courtCode") or ""
    decision = it.get("decisionDate")
    tail = f"  ·  {decision}" if decision else ""
    return f"{parties} — {court}{tail}"


def _format_ecourts_digest(it: dict) -> str | None:
    # caseStatus is rendered by the frontend as a coloured badge next to
    # the title (Dismissed / Allowed / Disposed / Pending / …), so don't
    # duplicate it here in the digest text.
    bits: list[str] = []
    ct = it.get("caseType")
    if ct and ct != "UNKNOWN":
        bits.append(str(ct))
    judges = it.get("judges") or []
    if judges:
        bits.append("Bench: " + ", ".join(str(j) for j in judges[:2]))
    jc = it.get("judgmentCount") or 0
    if jc > 0:
        bits.append(f"{jc} judgment" + ("" if jc == 1 else "s"))
    return " · ".join(bits) if bits else None


@router.get("/recent")
def recent_judgments(
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
    limit: int = Query(6, ge=1, le=50),
) -> dict:
    """Latest N judgments. Prefers live eCourts data when available; local
    corpus is the fallback so the UI never renders empty.

    Cached for 5 minutes per limit — the Case Law page fires this on every
    visit and eCourts responds in ~1-3 s cold. Cache turns repeat visits
    into a memory lookup and shaves the page's initial load noticeably.
    """
    import time
    now = time.time()
    cached = _RECENT_CACHE.get(limit)
    if cached and (now - cached[0] < _RECENT_TTL_S):
        return cached[1]

    # Try eCourts first — one filtered search, sorted newest-first.
    #   * pageSize (not `limit`) is the honoured page-size param.
    #   * decisionDateFrom = today - 180 days keeps the widget genuinely
    #     "recent"; older cases dominate the DESC feed otherwise because
    #     they have hasJudgments=true stamped for years.
    #   * Also excludes NULL decisionDate rows implicitly (they can't
    #     satisfy the >= filter).
    if _ecourts.available():
        try:
            today = datetime.now(timezone.utc).date()
            from datetime import timedelta as _td
            since = (today - _td(days=180)).isoformat()
            data = _ecourts.get(
                "/api/partner/search",
                params={
                    "hasJudgments": "true",
                    "sort": "decisionDate",
                    "order": "desc",
                    "pageSize": limit,
                    "decisionDateFrom": since,
                    "decisionDateTo": today.isoformat(),
                },
                long=True,
            )
            if isinstance(data, dict):
                results = data.get("results") or []
                items = [
                    {
                        "id": it.get("cnr"),
                        "title": _format_ecourts_title(it),
                        "digest": _format_ecourts_digest(it),
                        # Deep link to the official eCourts CNR-status portal
                        # (the third-party ecourtsindia.com wrapper does not
                        # expose a public per-case page — its /case/{cnr}
                        # route 404s). See _ecourts_case_url for details.
                        "source_url": _ecourts_case_url(it.get("cnr")),
                        "sections_cited": list(it.get("actsAndSections") or []),
                        "published_date": it.get("decisionDate"),
                        "status": (it.get("caseStatus") or "") if (it.get("caseStatus") or "") != "UNKNOWN" else "",
                    }
                    for it in results
                ]
                if items:
                    payload = {"items": items, "source": "ecourts"}
                    _RECENT_CACHE[limit] = (now, payload)
                    return payload
        except _ecourts.EcourtsError:
            # Fall through to local — never break the widget on upstream error.
            pass

    payload = {"items": _local_recent(db, limit), "source": "corpus"}
    _RECENT_CACHE[limit] = (now, payload)
    return payload


# ==========================================================================
# eCourts India — live court-tracking API. Independent of the IndianKanoon
# retrieval stack above. Each route thin-wraps a partner endpoint and
# converts EcourtsError → HTTPException so the frontend gets a clean shape.
# ==========================================================================
def _wrap_ecourts(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except _ecourts.EcourtsError as e:
        # 401/403 → 502 (upstream auth) so we don't leak the API state to the
        # user. Every other 4xx/5xx passes through with its message.
        status = 502 if e.status in (401, 403) else int(e.status)
        raise HTTPException(status_code=status, detail=str(e)) from e


@router.get("/ecourts/status")
def ecourts_status(p: Principal = Depends(get_principal)) -> dict:
    """Cheap health probe — reveals whether the API key is configured
    without hitting the upstream. Frontend uses this to gate the eCourts UI."""
    return {
        "enabled": _ecourts.available(),
        "base_url": "https://webapi.ecourtsindia.com" if _ecourts.available() else None,
    }


@router.get("/ecourts/states")
def ecourts_states(p: Principal = Depends(get_principal)) -> dict:
    """List of Indian states (code + name) as seen by eCourts."""
    data = _wrap_ecourts(_ecourts.get, "/api/partner/causelist/court-structure/states")
    return {"items": data}


@router.get("/ecourts/states/{state_code}/districts")
def ecourts_districts(state_code: str, p: Principal = Depends(get_principal)) -> dict:
    """Districts for a state — includes High Court entries too (districtCode='HC')."""
    data = _wrap_ecourts(
        _ecourts.get,
        f"/api/partner/causelist/court-structure/states/{state_code}/districts",
    )
    return {"items": data}


@router.get("/ecourts/enums")
def ecourts_enums(p: Principal = Depends(get_principal)) -> dict:
    """Enum values (case status codes, case types, etc.) used by the search
    endpoint. Frontend uses this to populate dropdowns."""
    return _wrap_ecourts(_ecourts.get, "/api/partner/enums")


@router.get("/ecourts/search/capabilities")
def ecourts_search_capabilities(p: Principal = Depends(get_principal)) -> dict:
    """What fields the search endpoint supports (sort / facet / filter).
    Useful for building the UI without hardcoding field names."""
    return _wrap_ecourts(_ecourts.get, "/api/partner/search/capabilities")


@router.get("/ecourts/case/{cnr}")
def ecourts_case(cnr: str, p: Principal = Depends(get_principal)) -> dict:
    """Full case detail by CNR (Case Number Record) — the eCourts unique id.
    Returns judges, party names, hearings, orders, filing/decision dates."""
    return _wrap_ecourts(_ecourts.get, f"/api/partner/case/{cnr}")


@router.get("/websearch")
def rulings_websearch(q: str, p: Principal = Depends(get_principal)) -> dict:
    """Gemini + Google-Search-grounded answer for a free-text case query.

    Used as a FALLBACK on the case-detail dialog: when the eCourts partner
    API returns no structured data for a CNR (rare — happens for very old,
    non-migrated, or sealed records), the frontend calls this endpoint with
    the case title / CNR to fetch a grounded web summary + reputable
    sources so the user still gets *something* useful.

    Reuses the same rate-limited Gemini path as the Ask-bot's web fallback,
    so we don't need another provider or key.
    """
    from app.services import gemini_search  # heavy import, lazy-load
    query = (q or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="q parameter is required")
    if not gemini_search.available():
        raise HTTPException(status_code=503, detail="Web search is not configured")
    text, sources = gemini_search.web_answer(query)
    return {"text": text or "", "sources": sources or []}


@router.get("/ecourts/search")
def ecourts_search(
    p: Principal = Depends(get_principal),
    state: str | None = Query(None, description="State code (DL, MH, KA, …) — maps to eCourts `stateCodes`"),
    district_code: str | None = Query(None, description="District code within state"),
    court_level: str | None = Query(None, description="SC / HC / DC / TRIBUNAL"),
    court_code: str | None = Query(None, description="Court code (e.g., DLHC01)"),
    case_type: str | None = Query(None),
    case_status: str | None = Query(None),
    judge_name: str | None = Query(None, description="Judge surname — maps to eCourts `judges`"),
    party_name: str | None = Query(None, description="Party name — maps to eCourts `petitioners`"),
    date_from: date | None = Query(None, description="Decision date lower bound (YYYY-MM-DD)"),
    date_to: date | None = Query(None, description="Decision date upper bound (YYYY-MM-DD)"),
    filing_year: int | None = Query(None, ge=1900, le=2100),
    decision_year: int | None = Query(None, ge=1900, le=2100),
    has_judgments: bool | None = Query(None),
    has_orders: bool | None = Query(None),
    sort: str = Query("decisionDate", description="Field to sort by (see /search/capabilities)"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1, le=1000),
    limit: int = Query(20, ge=1, le=100),
) -> dict:
    """Fielded case search. All filters are optional; combine as needed.

    Param name mapping (verified against eCourts /search/capabilities):
      state         → stateCodes   (plural! the singular is silently ignored)
      judge_name    → judges       (partial-match, phrase mode)
      party_name    → petitioners
      date_from     → decisionDateFrom
      date_to       → decisionDateTo
    """
    params: dict[str, str | int | bool] = {
        "sort": sort,
        "order": order,
        "page": page,
        "limit": limit,
    }
    if state:                params["stateCodes"] = state
    if district_code:        params["districtCode"] = district_code
    if court_level:          params["courtLevel"] = court_level
    if court_code:           params["courtCode"] = court_code
    if case_type:            params["caseType"] = case_type
    if case_status:          params["caseStatus"] = case_status
    if judge_name:           params["judges"] = judge_name
    if party_name:           params["petitioners"] = party_name
    if date_from:            params["decisionDateFrom"] = date_from.isoformat()
    if date_to:              params["decisionDateTo"] = date_to.isoformat()
    if filing_year:          params["filingYear"] = filing_year
    if decision_year:        params["decisionYear"] = decision_year
    if has_judgments is not None: params["hasJudgments"] = str(has_judgments).lower()
    if has_orders is not None:    params["hasOrders"] = str(has_orders).lower()

    data = _wrap_ecourts(_ecourts.get, "/api/partner/search", params=params, long=True)
    if isinstance(data, dict):
        items = data.get("results") or data.get("items") or []
        return {
            "items": items,
            "page": page,
            "limit": limit,
            "total": int(data.get("totalHits") or data.get("total") or data.get("count") or len(items)),
            "total_pages": int(data.get("totalPages") or 0),
            "facets": data.get("facets") or {},
        }
    return {"items": data or [], "page": page, "limit": limit, "total": len(data or [])}
