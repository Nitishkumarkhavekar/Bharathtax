"""Redis-backed answer cache for the Ask Bot.

Officers ask the same handful of high-frequency questions repeatedly ("current
80C limit", "HRA exemption rules"). Every such query hit both the primary
model and — worse — the Gemini grounded-search fallback, at ~₹3 per grounded
call. This module short-circuits repeats within a TTL window.

Design:
* Key: SHA-256 of normalised question + (optional) domain slug.
* Value: JSON blob of the full Answer payload.
* TTL: 24 h by default (env `ASK_CACHE_TTL_SECONDS`). Time-sensitive queries
  can bypass by simply not caching (see `should_cache`).
* Backend: the same Redis we already run for Celery.

Absolutely fail-open — if Redis is unreachable, we silently skip the cache
and answer live. Never let telemetry infrastructure break the user path.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any

import redis

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

_TTL = int(os.getenv("ASK_CACHE_TTL_SECONDS", str(24 * 3600)))
_ENABLED = os.getenv("ASK_CACHE_ENABLED", "1").lower() not in ("0", "false", "no", "")
_PREFIX = "bt:qcache:"

_client: redis.Redis | None = None


def _get_client() -> redis.Redis | None:
    """Lazy client. Returns None if Redis is unavailable."""
    global _client
    if not _ENABLED:
        return None
    if _client is None:
        try:
            _client = redis.Redis.from_url(
                settings.redis_url, socket_timeout=1.0, socket_connect_timeout=1.0,
            )
        except Exception as exc:
            log.warning("qcache: redis init failed (%s) — disabling", exc)
            return None
    return _client


_WHITESPACE_RE = re.compile(r"\s+")


def _normalize(q: str) -> str:
    """Lowercase, collapse whitespace, strip punctuation at the ends. Case /
    trailing-question-mark variants collapse to the same cache key."""
    n = (q or "").lower().strip()
    n = _WHITESPACE_RE.sub(" ", n)
    n = n.strip(" .!?,;:")
    return n


def _key(question: str, domain: str | None) -> str:
    seed = f"{domain or ''}|{_normalize(question)}"
    return _PREFIX + hashlib.sha256(seed.encode("utf-8")).hexdigest()


def should_cache(*, meta: dict) -> bool:
    """Don't cache answers derived from a live web-search — they go stale
    fast, and a stale "latest circular" answer is worse than a fresh call.
    Also skip greetings (they're canned already, cheap to regenerate).
    """
    r = (meta or {}).get("retrieval") or ""
    if "web-search:gemini" in r:
        return False
    if r in ("greeting", "empty"):
        return False
    return True


def get(question: str, *, domain: str | None = None) -> dict | None:
    """Return the cached Answer payload dict, or None on miss / disabled /
    Redis outage."""
    c = _get_client()
    if c is None:
        return None
    try:
        raw = c.get(_key(question, domain))
        if not raw:
            return None
        return json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        log.warning("qcache: read failed (%s)", exc)
        return None


def put(question: str, payload: dict, *, domain: str | None = None) -> None:
    """Store a payload for TTL. Never raises."""
    c = _get_client()
    if c is None:
        return
    try:
        c.setex(_key(question, domain), _TTL, json.dumps(payload, default=str))
    except Exception as exc:  # noqa: BLE001
        log.warning("qcache: write failed (%s)", exc)


def stats() -> dict[str, Any]:
    """Best-effort snapshot of cache stats for /admin telemetry."""
    c = _get_client()
    if c is None:
        return {"enabled": False}
    try:
        keys = c.keys(_PREFIX + "*") or []
        return {
            "enabled": True,
            "ttl_seconds": _TTL,
            "entries": len(keys),
        }
    except Exception as exc:  # noqa: BLE001
        return {"enabled": True, "error": str(exc)}
