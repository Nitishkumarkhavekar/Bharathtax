"""Latest tax news feed.

Backed by `news_items` — populated on a 30-minute Celery cadence from the
configured `news_sources` (Google Alerts Atom, Google News RSS, PIB, and
any admin-added publisher RSS). The frontend `/news` page consumes:

  * ``GET /news``            → paginated list, optional q / category filters
  * ``GET /news/categories`` → distinct categories for the filter chips
  * ``POST /news/refresh``   → synchronous re-poll (dev + admin), returns totals

The endpoints are cheap — read-only queries on a small, indexed table.
Authentication follows the same principal-based model as the rest of the
app; no wing gate.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import String, and_, desc, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, get_principal
from app.core.db import get_db
from app.models.news import NewsItem, NewsSource

router = APIRouter(prefix="/news", tags=["news"])
public_router = APIRouter(prefix="/news", tags=["news-public"])


class NewsItemOut(BaseModel):
    id: int
    title: str
    url: str
    snippet: str | None
    source_name: str
    source_category: str | None
    image_url: str | None
    published_at: datetime
    first_seen_at: datetime

    model_config = {"from_attributes": True}


class NewsListOut(BaseModel):
    items: list[NewsItemOut]
    total: int
    latest_first_seen_at: datetime | None


def _parse_ymd(raw: str, name: str) -> date:
    """Strict YYYY-MM-DD parse — reject other formats early with a 400."""
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(400, f"{name} must be YYYY-MM-DD")


@router.get("", response_model=NewsListOut)
def list_news(
    q: str | None = Query(None, description="Free-text search on title + snippet"),
    category: str | None = Query(None, description="Filter to one source category"),
    from_date: str | None = Query(
        None, description="Include items published on/after this YYYY-MM-DD date"),
    to_date: str | None = Query(
        None, description="Include items published on/before this YYYY-MM-DD date"),
    since_days: int | None = Query(
        None, ge=1, le=365,
        description="Shortcut for 'last N days'; overridden by from_date/to_date"),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    sort: Literal["latest", "trending"] = Query("latest"),
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> NewsListOut:
    """Paginated newest-first list. `q` searches title + snippet; `category`
    restricts to a single source group. Date filtering: pass either
    `since_days` (shortcut for Today/7d/30d chips) OR an explicit
    `from_date` / `to_date` range."""
    filters = []
    if q:
        needle = f"%{q.lower()}%"
        filters.append(or_(
            func.lower(NewsItem.title).like(needle),
            func.lower(func.coalesce(NewsItem.snippet, "")).like(needle),
        ))
    if category and category.lower() != "all":
        filters.append(NewsItem.source_category == category)

    # Date filtering. Explicit from/to wins over since_days so a user
    # who sets both gets what they typed. Boundaries are inclusive and
    # in UTC — the poller stamps published_at as UTC too.
    if from_date:
        d0 = _parse_ymd(from_date, "from_date")
        filters.append(NewsItem.published_at >= datetime.combine(d0, time.min, tzinfo=timezone.utc))
    elif since_days:
        # since_days=1 → "today only" (from midnight of today).
        cutoff = datetime.combine(
            date.today() - timedelta(days=since_days - 1), time.min, tzinfo=timezone.utc,
        )
        filters.append(NewsItem.published_at >= cutoff)
    if to_date:
        d1 = _parse_ymd(to_date, "to_date")
        filters.append(NewsItem.published_at <= datetime.combine(d1, time.max, tzinfo=timezone.utc))

    order = desc(NewsItem.first_seen_at) if sort == "trending" else desc(NewsItem.published_at)

    q_items = (
        select(NewsItem)
        .where(and_(*filters)) if filters else select(NewsItem)
    ).order_by(order).offset(offset).limit(limit)

    q_total = (
        select(func.count(NewsItem.id))
        .where(and_(*filters)) if filters else select(func.count(NewsItem.id))
    )

    items = list(db.scalars(q_items))
    total = int(db.scalar(q_total) or 0)
    latest = db.scalar(select(func.max(NewsItem.first_seen_at)))
    return NewsListOut(
        items=[NewsItemOut.model_validate(i) for i in items],
        total=total,
        latest_first_seen_at=latest,
    )


@router.get("/categories")
def list_categories(
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> dict:
    """Distinct source categories — feeds the frontend filter chips."""
    rows = db.execute(
        select(NewsItem.source_category, func.count(NewsItem.id))
        .where(NewsItem.source_category.isnot(None))
        .group_by(NewsItem.source_category)
        .order_by(desc(func.count(NewsItem.id)))
    ).all()
    return {
        "categories": [
            {"name": name, "count": int(cnt)} for name, cnt in rows if name
        ]
    }


@public_router.get("/public", response_model=NewsListOut)
def public_latest_news(
    limit: int = Query(6, ge=1, le=20),
    db: Session = Depends(get_db),
) -> NewsListOut:
    """Unauthenticated latest-N headlines for the marketing landing page.
    Same shape as `GET /news` — but only the newest items, no filters,
    hard-capped at 20 so this can't be scraped as a free news API."""
    items = list(db.scalars(
        select(NewsItem).order_by(desc(NewsItem.published_at)).limit(limit)
    ))
    total = int(db.scalar(select(func.count(NewsItem.id))) or 0)
    latest = db.scalar(select(func.max(NewsItem.first_seen_at)))
    return NewsListOut(
        items=[NewsItemOut.model_validate(i) for i in items],
        total=total,
        latest_first_seen_at=latest,
    )


@router.post("/refresh")
def refresh_news(
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> dict:
    """Synchronously re-poll all sources. Handy in dev and as a manual
    'refresh' button in the UI; the Celery beat task does the same thing
    on a 30-minute schedule in production."""
    from app.services import news_ingest
    news_ingest.ensure_default_sources(db)
    return news_ingest.poll_all(db)
