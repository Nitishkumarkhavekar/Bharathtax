"""Pull latest tax news from configured feeds (Google Alerts Atom, RSS,
PIB) and upsert into `news_items`.

Contract:
  * Idempotent — the SHA-256 hash of (normalised_title + '|' + url) is the
    dedup key, so re-polling the same feed never duplicates a story.
  * Never raises — any per-feed failure is logged onto `NewsSource.last_error`
    and the sweep continues to the next source.
  * Zero external deps beyond `httpx` + the stdlib XML parser, so this
    module works without adding `feedparser` to the requirements.
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
from datetime import datetime, timezone
from typing import Iterable
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.news import NewsItem, NewsSource

log = logging.getLogger("news_ingest")

# Atom / RSS both use these namespaces. `{*}` is a fallback for feeds that
# omit the xmlns declaration (rare but not unseen).
_ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}

# Google Alerts wraps each result's title/summary in HTML and includes a
# redirect URL in the <link> href. Strip both for a clean card render.
_TAG_STRIP_RE = re.compile(r"<[^>]+>")


def _clean_text(raw: str | None) -> str:
    if not raw:
        return ""
    stripped = _TAG_STRIP_RE.sub("", raw)
    return html.unescape(stripped).strip()


def _resolve_google_redirect(href: str) -> str:
    """Turn a Google Alerts / Google News redirect URL into the underlying
    article URL. Handles both classic forms:
      * https://www.google.com/url?...&url=<real>&...
      * https://www.google.com/url?...&q=<real>&...
    Anything else (including the newer news.google.com/rss/articles/<id>
    permalinks we can't unwrap without a network hop) is passed through
    unchanged; the frontend still shows a meaningful hostname when it can
    parse a publisher from the title."""
    if not href:
        return href
    from urllib.parse import parse_qs, unquote, urlparse
    try:
        u = urlparse(href)
    except Exception:  # noqa: BLE001
        return href
    host = (u.netloc or "").lower()
    if host not in ("www.google.com", "google.com"):
        return href
    if not u.path.startswith("/url"):
        return href
    q = parse_qs(u.query)
    for key in ("url", "q"):
        vals = q.get(key)
        if vals and vals[0]:
            return unquote(vals[0])
    return href


# The Google News RSS variant appends the publisher after a trailing dash:
# "ITR filing deadline today: what to know - Mint" → publisher "Mint".
# Strip the suffix for the stored title so the card doesn't read that
# publisher twice; return the suffix so the ingestor can save it as
# `source_name` (overriding the aggregator name).
_TITLE_PUBLISHER_RE = re.compile(r"^(?P<title>.+?)\s+-\s+(?P<publisher>[^-]{2,60})\s*$")


# Match  <meta property="og:image" content="…">   and the twitter variant.
# Non-greedy, case-insensitive, tolerant of attribute order and single-quotes.
_OG_IMAGE_RE = re.compile(
    r"""<meta\s+[^>]*?(?:property|name)\s*=\s*['"](?:og:image(?::url)?|twitter:image(?::src)?)['"]"""
    r"""\s+[^>]*?content\s*=\s*['"]([^'"]+)['"]""",
    re.IGNORECASE | re.DOTALL,
)
# Reverse attribute order — some publishers write content first, property second.
_OG_IMAGE_REV_RE = re.compile(
    r"""<meta\s+[^>]*?content\s*=\s*['"]([^'"]+)['"]"""
    r"""\s+[^>]*?(?:property|name)\s*=\s*['"](?:og:image(?::url)?|twitter:image(?::src)?)['"]""",
    re.IGNORECASE | re.DOTALL,
)


def _extract_og_image(url: str, timeout_s: float = 5.0) -> str | None:
    """Best-effort OpenGraph image scrape. Returns an absolute image URL or
    None on any failure (timeout, non-200, no og:image found).

    Only the first ~64KB of the page body is inspected — every mainstream
    publisher puts <meta property="og:image"> in the <head>, which is
    always in the first few KB. Reading more would just cost bandwidth.
    """
    if not url:
        return None
    from urllib.parse import urljoin
    try:
        with httpx.Client(timeout=timeout_s, follow_redirects=True) as c:
            r = c.get(
                url,
                headers={
                    # Publishers routinely 403 non-browser User-Agents; a
                    # realistic Chrome UA gets through cleanly. We're only
                    # reading the first few KB of HTML to lift <meta og:image>,
                    # not scraping article bodies — well within Fair Use / RSS
                    # licence norms.
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/122.0.0.0 Safari/537.36"
                    ),
                    "Accept": "text/html,application/xhtml+xml,*/*;q=0.9",
                    "Accept-Language": "en-IN,en;q=0.9",
                    "Cache-Control": "no-cache",
                },
            )
            if r.status_code != 200 or "text/html" not in (r.headers.get("content-type", "")):
                return None
            body = r.text[:65_536]
    except Exception:  # noqa: BLE001 — best-effort; silent failure is fine
        return None
    m = _OG_IMAGE_RE.search(body) or _OG_IMAGE_REV_RE.search(body)
    if not m:
        return None
    img = html.unescape(m.group(1).strip())
    # Resolve schema-relative and root-relative URLs to absolute.
    if img.startswith("//"):
        img = "https:" + img
    elif img.startswith("/"):
        img = urljoin(url, img)
    return img[:1000] if img.startswith(("http://", "https://")) else None


def _split_title_publisher(raw_title: str) -> tuple[str, str | None]:
    """Return (clean_title, publisher_or_None)."""
    if not raw_title:
        return raw_title, None
    m = _TITLE_PUBLISHER_RE.match(raw_title.strip())
    if not m:
        return raw_title, None
    pub = m.group("publisher").strip()
    # Guard against false positives — a real trailing publisher name is
    # short, doesn't contain a colon, and doesn't look like a sentence
    # fragment ("... in the last-minute rush").
    if len(pub) > 60 or ":" in pub or pub.lower().startswith(("the ", "a ", "an ")):
        return raw_title, None
    return m.group("title").strip(), pub


def _hash_item(title: str, url: str) -> str:
    """Dedup key. Title lower-cased + whitespace-normalised so identical
    stories from different feed replays collapse to one row."""
    norm_title = re.sub(r"\s+", " ", (title or "").strip().lower())
    payload = f"{norm_title}|{url or ''}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _parse_date(raw: str | None) -> datetime:
    """Parse an ISO/RFC-822/RFC-3339 date; fall back to 'now' on any failure."""
    if not raw:
        return datetime.now(timezone.utc)
    raw = raw.strip()
    # Common RFC 3339 form (Google Alerts, most Atom feeds).
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S.%fZ",
    ):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    # RFC-822 (some RSS feeds).
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(raw)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001
        return datetime.now(timezone.utc)


def _iter_atom_items(root: ET.Element) -> Iterable[dict]:
    """Yield {title, url, snippet, published_at} for each <entry> in an Atom feed."""
    for entry in root.findall("atom:entry", _ATOM_NS) or root.findall(".//{*}entry"):
        title_el = entry.find("atom:title", _ATOM_NS) or entry.find("{*}title")
        link_el = entry.find("atom:link", _ATOM_NS) or entry.find("{*}link")
        summary_el = (
            entry.find("atom:content", _ATOM_NS)
            or entry.find("{*}content")
            or entry.find("atom:summary", _ATOM_NS)
            or entry.find("{*}summary")
        )
        published_el = (
            entry.find("atom:published", _ATOM_NS)
            or entry.find("{*}published")
            or entry.find("atom:updated", _ATOM_NS)
            or entry.find("{*}updated")
        )
        title = _clean_text(title_el.text if title_el is not None else None)
        href = (link_el.get("href") if link_el is not None else "") or ""
        url = _resolve_google_redirect(href) if href else ""
        snippet = _clean_text(summary_el.text if summary_el is not None else None)
        published = _parse_date(published_el.text if published_el is not None else None)
        if title and url:
            yield {"title": title, "url": url, "snippet": snippet, "published_at": published}


def _iter_rss_items(root: ET.Element) -> Iterable[dict]:
    """Yield items from a classic RSS 2.0 feed."""
    for item in root.findall(".//item"):
        title = _clean_text(item.findtext("title"))
        url = (item.findtext("link") or "").strip()
        snippet = _clean_text(item.findtext("description"))
        published = _parse_date(item.findtext("pubDate"))
        if title and url:
            yield {"title": title, "url": url, "snippet": snippet, "published_at": published}


def _fetch_feed(url: str, timeout_s: float = 20.0) -> ET.Element:
    """GET the feed URL and parse it as XML. Raises on network / parse error."""
    with httpx.Client(timeout=timeout_s, follow_redirects=True) as c:
        r = c.get(
            url,
            headers={
                # Publishers often 403 non-browser UAs, so we use a realistic
                # Chrome one — RSS is intended for public consumption.
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
                "Accept": (
                    "application/atom+xml, application/rss+xml, "
                    "application/xml;q=0.9, text/xml;q=0.8, */*;q=0.6"
                ),
                "Accept-Language": "en-IN,en;q=0.9",
            },
        )
        r.raise_for_status()
        return ET.fromstring(r.content)


def _insert_items(
    db: Session, source: NewsSource, items: Iterable[dict], snippet_max: int = 500,
) -> int:
    """Upsert-ish: insert each item; skip on unique-hash conflict.

    Attribution rule: if the feed title carries a trailing " - Publisher"
    (Google News's standard suffix), we split it out and store `Publisher`
    as `source_name`. Otherwise we fall back to the source's `name` unless
    it is an aggregator (Google Alerts / Google News) — in which case we
    derive a friendly name from the article URL's hostname. That way a
    reader never sees "via Google Alerts" on a card; they see the real
    publisher."""
    from urllib.parse import urlparse

    def _display_source(raw_title: str, url: str, feed_name: str) -> tuple[str, str]:
        """Return (clean_title, source_name_to_store)."""
        clean_title, pub = _split_title_publisher(raw_title)
        if pub:
            return clean_title, pub
        # Fallback: aggregators must never surface as "via <aggregator>".
        # Derive publisher from the article URL hostname (trimmed www).
        low = feed_name.lower()
        if "google alert" in low or "google news" in low:
            try:
                host = urlparse(url).netloc.replace("www.", "")
            except Exception:  # noqa: BLE001
                host = ""
            # A google.com URL we couldn't unwrap → hide the source label
            # entirely by using an empty placeholder; the frontend hides
            # rows with no derivable publisher name.
            if host and host not in ("google.com", "news.google.com"):
                return clean_title, host
            return clean_title, ""
        return clean_title, feed_name

    inserted = 0
    for it in items:
        clean_title, disp_source = _display_source(it["title"], it["url"], source.name)
        h = _hash_item(clean_title, it["url"])
        # Fast-path check to avoid an extra INSERT-then-rollback per known item.
        exists = db.scalar(select(NewsItem.id).where(NewsItem.hash == h))
        if exists:
            continue
        # Skip items where we couldn't derive a real publisher AND the URL
        # remained an unwrappable google.com redirect — showing them would
        # betray the aggregator source. Better to drop the story than
        # mislead the reader on attribution.
        if not disp_source:
            continue
        # Best-effort og:image. We only try if the URL looks like a real
        # publisher URL — a lingering google.com/url redirect wouldn't have
        # a useful OG tag anyway.
        img: str | None = None
        try:
            host = urlparse(it["url"]).netloc.lower()
            if host and "google.com" not in host and "news.google.com" not in host:
                img = _extract_og_image(it["url"])
        except Exception:  # noqa: BLE001
            img = None
        row = NewsItem(
            source_id=source.id,
            source_name=disp_source[:120],
            source_category=source.category,
            title=clean_title[:500],
            url=it["url"][:1000],
            snippet=(it["snippet"] or "")[:snippet_max] or None,
            image_url=img,
            hash=h,
            published_at=it["published_at"],
        )
        db.add(row)
        try:
            db.commit()
            inserted += 1
        except IntegrityError:
            # A concurrent poller beat us to it — that's fine, our dedup
            # key is what we wanted.
            db.rollback()
    return inserted


def poll_source(db: Session, source: NewsSource) -> dict:
    """Pull one source, insert new items, update last_polled_at / last_error."""
    result = {"source": source.name, "inserted": 0, "ok": False}
    try:
        root = _fetch_feed(source.url)
        # Atom root tag looks like '{http://www.w3.org/2005/Atom}feed';
        # RSS root is '<rss>'.
        is_atom = root.tag.endswith("feed")
        items = _iter_atom_items(root) if is_atom else _iter_rss_items(root)
        result["inserted"] = _insert_items(db, source, items)
        source.last_polled_at = datetime.now(timezone.utc)
        source.last_error = None
        db.commit()
        result["ok"] = True
    except Exception as e:  # noqa: BLE001 — one bad feed must not abort the sweep
        log.warning("poll_source %s failed: %s", source.name, e)
        source.last_polled_at = datetime.now(timezone.utc)
        source.last_error = str(e)[:500]
        try:
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
        result["error"] = str(e)[:200]
    return result


def poll_all(db: Session | None = None) -> dict:
    """Iterate every active source and roll up the ingestion totals."""
    own_session = db is None
    db = db or SessionLocal()
    totals = {"sources": 0, "inserted": 0, "failed": 0, "details": []}
    try:
        sources = list(db.scalars(
            select(NewsSource).where(NewsSource.is_active.is_(True))
        ))
        totals["sources"] = len(sources)
        for src in sources:
            r = poll_source(db, src)
            totals["details"].append(r)
            totals["inserted"] += r.get("inserted", 0)
            if not r.get("ok"):
                totals["failed"] += 1
    finally:
        if own_session:
            db.close()
    log.info("news poll_all done: %s", totals)
    return totals


# ---- default source bootstrap ---------------------------------------------
# The Google Alerts Atom feed URL is baked in as the initial source; new
# feeds can be added later via a small admin call or a direct DB row.
_DEFAULT_GOOGLE_ALERT_URL = (
    "https://www.google.com/alerts/feeds/07457626398667742648/14793413761167313090"
)

# Additional zero-cost feeds bootstrap. Google News search RSS covers the
# broad discovery layer (Alerts sometimes misses items); the PIB Ministry of
# Finance RSS is the official channel for CBDT / Budget releases.
def _gnews(query: str) -> str:
    """Build a Google News RSS URL for a search query, India-locale."""
    from urllib.parse import quote_plus
    return (
        "https://news.google.com/rss/search"
        f"?q={quote_plus(query)}&hl=en-IN&gl=IN&ceid=IN:en"
    )


# The default feed roster spans ALL Indian tax pillars — income-tax + GST +
# customs + transfer pricing + international tax + tribunal rulings — so a
# reader sees the full tax landscape, not just direct-tax stories. Category
# labels map to the frontend filter chips.
_DEFAULT_FEEDS: list[dict] = [
    # Google Alerts + Google News RSS were both dropped: they now hand out
    # news.google.com/rss/articles/<id> permalinks that only resolve via
    # Google's client-side JS, which means our og:image scraper can never
    # get a hero image and cards always fell back to the placeholder tile.
    # Every remaining source below returns a direct publisher URL so cards
    # get a real og:image.
    #

    # ---------------------------------------------------------------------
    # Direct publisher RSS feeds — these return real article URLs (not
    # Google News permalinks), so og:image scraping actually works.
    # Preferred over Google News queries when a publisher exposes a tax-
    # tagged feed.
    # ---------------------------------------------------------------------
    {
        "name": "TaxGuru",
        "kind": "rss",
        "url": "https://taxguru.in/feed/",
        "category": "General",
    },
    {
        "name": "Taxscan",
        "kind": "rss",
        "url": "https://www.taxscan.in/feed/",
        "category": "Case law",
    },
    {
        "name": "Livemint — Money",
        "kind": "rss",
        "url": "https://www.livemint.com/rss/money",
        "category": "General",
    },
    {
        "name": "Economic Times — Wealth / Tax",
        "kind": "rss",
        "url": "https://economictimes.indiatimes.com/wealth/tax/rssfeeds/1466318007.cms",
        "category": "General",
    },
    {
        "name": "Bar and Bench",
        "kind": "rss",
        "url": "https://www.barandbench.com/feed",
        "category": "Case law",
    },
]


def rewrite_existing_items(db: Session | None = None) -> dict:
    """One-shot cleanup for rows inserted before the aggregator-hiding rule
    landed. Unwraps google.com/url? redirects, strips the trailing
    " - Publisher" from titles into source_name, and drops rows where
    neither is possible (they'd read 'via Google Alerts')."""
    from urllib.parse import urlparse
    own = db is None
    db = db or SessionLocal()
    updated = deleted = 0
    try:
        rows = list(db.scalars(select(NewsItem)))
        for r in rows:
            new_url = _resolve_google_redirect(r.url)
            title, pub = _split_title_publisher(r.title)
            src_low = (r.source_name or "").lower()
            is_aggregator = "google alert" in src_low or "google news" in src_low
            new_source = r.source_name
            if pub:
                new_source = pub[:120]
            elif is_aggregator:
                try:
                    host = urlparse(new_url).netloc.replace("www.", "")
                except Exception:  # noqa: BLE001
                    host = ""
                if host and host not in ("google.com", "news.google.com"):
                    new_source = host[:120]
                else:
                    # Genuinely unattributable → remove.
                    db.delete(r)
                    deleted += 1
                    continue
            changed = (
                new_url != r.url or title != r.title or new_source != r.source_name
            )
            if changed:
                r.url = new_url[:1000]
                r.title = title[:500]
                r.source_name = new_source
                # Recompute the dedup hash so future polls of the same
                # cleaned story don't insert a duplicate.
                r.hash = _hash_item(title, new_url)
                updated += 1
        db.commit()
    finally:
        if own:
            db.close()
    return {"updated": updated, "deleted": deleted}


def hydrate_images(db: Session | None = None, limit: int = 60) -> dict:
    """Scrape og:image for rows that still have image_url NULL. Bounded per
    invocation so a big backlog doesn't wedge the beat scheduler. Called
    both from a manual admin refresh and from the periodic poller."""
    from urllib.parse import urlparse
    own = db is None
    db = db or SessionLocal()
    found = 0
    tried = 0
    try:
        rows = list(db.scalars(
            select(NewsItem)
            .where(NewsItem.image_url.is_(None))
            .order_by(NewsItem.published_at.desc())
            .limit(limit)
        ))
        for r in rows:
            try:
                host = urlparse(r.url or "").netloc.lower()
            except Exception:  # noqa: BLE001
                host = ""
            if not host or "google.com" in host:
                continue
            tried += 1
            img = _extract_og_image(r.url)
            if img:
                r.image_url = img
                found += 1
        if found:
            db.commit()
    finally:
        if own:
            db.close()
    return {"tried": tried, "found": found}


def ensure_default_sources(db: Session | None = None) -> int:
    """Idempotent bootstrap — insert the default feeds if the table is empty
    for that URL. Called on API startup so a fresh install has news from
    minute one without any manual setup."""
    own_session = db is None
    db = db or SessionLocal()
    added = 0
    try:
        for cfg in _DEFAULT_FEEDS:
            hit = db.scalar(select(NewsSource.id).where(NewsSource.url == cfg["url"]))
            if hit:
                continue
            db.add(NewsSource(
                name=cfg["name"],
                kind=cfg["kind"],
                url=cfg["url"],
                category=cfg.get("category"),
                poll_interval_minutes=30,
                is_active=True,
            ))
            added += 1
        if added:
            db.commit()
    finally:
        if own_session:
            db.close()
    return added
