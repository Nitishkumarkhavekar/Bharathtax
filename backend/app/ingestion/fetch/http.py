"""Polite HTTP fetcher for sources that CAN be auto-fetched.

Hard rules (the govt site must never be hammered):
  * per-host rate limit (sleep between requests)
  * on-disk cache keyed by URL, so re-runs don't re-hit the site
  * a descriptive User-Agent
This is intentionally minimal; per-source listing/crawl logic can grow later.
TODO: add per-source link discovery for circular/notification index pages.
"""
from __future__ import annotations

import hashlib
import time
from collections.abc import Iterator
from pathlib import Path

import httpx

from app.core.config import settings
from app.core.enums import SourceType
from app.core.logging import get_logger
from app.ingestion.contracts import FetchedItem

log = get_logger(__name__)
_last_request_at: dict[str, float] = {}


def _respect_rate_limit(host: str, min_gap: float) -> None:
    last = _last_request_at.get(host)
    if last is not None:
        wait = min_gap - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
    _last_request_at[host] = time.monotonic()


def _cache_path(url: str) -> Path:
    key = hashlib.sha256(url.encode()).hexdigest()
    return Path(settings.crawl_cache_dir) / f"{key}.bin"


def _get(url: str, min_gap: float, use_cache: bool) -> bytes:
    cache = _cache_path(url)
    if use_cache and cache.exists():
        return cache.read_bytes()
    host = httpx.URL(url).host
    _respect_rate_limit(host, min_gap)
    headers = {"User-Agent": settings.crawl_user_agent}
    with httpx.Client(timeout=60.0, follow_redirects=True, headers=headers) as client:
        resp = client.get(url)
        resp.raise_for_status()
        data = resp.content
    if use_cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(data)
    return data


def fetch(source: dict) -> Iterator[FetchedItem]:
    """MVP: fetch the single configured URL. (List-page crawling is a TODO.)"""
    url = source.get("base_url")
    if not url:
        log.warning("http source %s has no base_url", source.get("key"))
        return
    min_gap = float(source.get("rate_limit_seconds", settings.crawl_rate_limit_seconds))
    use_cache = bool(source.get("cache", True))
    data = _get(url, min_gap, use_cache)
    ct = "application/pdf" if url.lower().endswith(".pdf") else "text/html"
    yield FetchedItem(
        source_key=source["key"],
        title=source.get("name", source["key"]),
        doc_type=SourceType(source["source_type"]),
        raw_bytes=data,
        content_type=ct,
        source_url=url,
        checksum=hashlib.sha256(data).hexdigest(),
    )
