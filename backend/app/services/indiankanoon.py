"""Indian Kanoon — live authoritative case-law fetch (Supreme Court / High
Courts / ITAT).

Our own corpus holds statute + SC/HC judgments but not the tribunal layer, so
when the chat is asked about a named case, a specific taxpayer's litigation, or
an ITAT ruling we don't hold, we search Indian Kanoon live, pull the top
judgment(s), and let the model ground its answer on the real text with a
citation that links back to indiankanoon.org (an authoritative source that
already passes the officer-facing allowlist).

Pay-per-call API, so: results are cached per query, and the number of full
(paid) document fetches per query is capped. Dormant until INDIANKANOON_API_TOKEN
is set — exactly like the Gemini web-search fallback.
"""
from __future__ import annotations

import os
import re
import time
from urllib.parse import quote

import httpx

from app.core.logging import get_logger

log = get_logger(__name__)

_TOKEN = os.getenv("INDIANKANOON_API_TOKEN", "").strip()
_BASE = os.getenv("INDIANKANOON_BASE_URL", "https://api.indiankanoon.org").rstrip("/")
# Each full-judgment fetch is a paid call — cap how many we pull per query.
_MAX_DOCS = int(os.getenv("INDIANKANOON_MAX_DOCS", "2"))
_MAX_DOC_CHARS = int(os.getenv("INDIANKANOON_MAX_DOC_CHARS", "6000"))

# In-process cache so re-asking the same case doesn't re-bill the API.
_CACHE: dict[str, tuple[float, list]] = {}
_CACHE_TTL = int(os.getenv("INDIANKANOON_CACHE_TTL", "86400"))  # 1 day
_CACHE_MAX = 512

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t]+")
_NL_RE = re.compile(r"\n{3,}")


def available() -> bool:
    return bool(_TOKEN)


def _headers() -> dict:
    return {"Authorization": f"Token {_TOKEN}", "Accept": "application/json"}


def _clean(html: str) -> str:
    """Strip Indian Kanoon's HTML down to readable judgment text."""
    t = _TAG_RE.sub(" ", html or "")
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"),
                 ("&gt;", ">"), ("&#39;", "'"), ("&quot;", '"')):
        t = t.replace(a, b)
    t = _WS_RE.sub(" ", t)
    t = _NL_RE.sub("\n\n", t)
    return t.strip()


def _post(path: str, timeout: float = 12.0) -> dict | None:
    if not available():
        return None
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout)) as c:
            r = c.post(f"{_BASE}{path}", headers=_headers())
        if r.status_code != 200:
            log.warning("indiankanoon %s -> HTTP %s: %s", path, r.status_code, r.text[:150])
            return None
        return r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("indiankanoon %s failed: %s", path, e)
        return None


def _doc_url(tid) -> str:
    return f"https://indiankanoon.org/doc/{tid}/"


def search(query: str, *, doctypes: str = "", max_results: int = 5,
           fetch_docs: bool = True) -> list[dict]:
    """Search Indian Kanoon; return ranked judgments each with court, date, a
    text excerpt, and a citable indiankanoon.org URL. Cached per (query, doctypes).

    doctypes narrows the corpus, e.g. "itat" or "judgments" — leave blank for all.
    """
    q = (query or "").strip()
    if not q or not available():
        return []
    ckey = f"{doctypes}|{q.lower()}"
    hit = _CACHE.get(ckey)
    if hit and (time.time() - hit[0]) < _CACHE_TTL:
        return hit[1]

    form = q + (f" doctypes:{doctypes}" if doctypes else "")
    data = _post(f"/search/?formInput={quote(form)}&pagenum=0")
    docs = (data or {}).get("docs") or []
    results: list[dict] = []
    for d in docs[:max_results]:
        results.append({
            "tid": d.get("tid"),
            "title": _clean(d.get("title") or ""),
            "court": d.get("docsource") or "",
            "date": d.get("publishdate") or "",
            "cited_by": d.get("numcitedby") or 0,
            "url": _doc_url(d.get("tid")),
            # Headline first; replaced with real judgment text for the top few.
            "excerpt": _clean(d.get("headline") or "")[:600],
        })
    # Pull full judgment text for the most relevant few so the model grounds on
    # the actual ruling, not just the search snippet. Fetched IN PARALLEL —
    # sequential fetches were the #1 cause of chat latency (each ~10s, so 2
    # docs was 20s just here; 3 case_law calls per answer = 60s wasted).
    if fetch_docs and results[:_MAX_DOCS]:
        import concurrent.futures as _futures
        top = results[:_MAX_DOCS]
        with _futures.ThreadPoolExecutor(max_workers=len(top)) as pool:
            fut_map = {pool.submit(_post, f"/doc/{r['tid']}/"): r for r in top}
            for fut in _futures.as_completed(fut_map):
                r = fut_map[fut]
                try:
                    full = fut.result()
                except Exception:  # noqa: BLE001
                    full = None
                if full and full.get("doc"):
                    r["excerpt"] = _clean(full["doc"])[:_MAX_DOC_CHARS]

    if len(_CACHE) > _CACHE_MAX:
        _CACHE.clear()
    _CACHE[ckey] = (time.time(), results)
    return results
