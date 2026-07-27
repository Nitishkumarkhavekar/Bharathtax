"""Lightweight, dependency-free per-key sliding-window rate limiter.

In-memory and per-process (so with N uvicorn workers the effective limit is
N×) — enough to blunt credential brute-force at the app layer. For a hard
guarantee, also add nginx `limit_req` on /auth in front of the app.
"""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

_LOCK = threading.Lock()
_HITS: dict[str, deque[float]] = defaultdict(deque)


def client_ip(request: Request | None) -> str:
    """Real client IP. Prefer the first hop of X-Forwarded-For (prod runs behind
    nginx, which sets it); fall back to the socket peer."""
    if request is None:
        return "unknown"
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def allow(key: str, *, max_hits: int, window_s: float) -> bool:
    """True if `key` is under the limit (and records this hit); False if over."""
    now = time.time()
    with _LOCK:
        dq = _HITS[key]
        cutoff = now - window_s
        while dq and dq[0] <= cutoff:
            dq.popleft()
        if len(dq) >= max_hits:
            return False
        dq.append(now)
        if len(_HITS) > 10_000:  # bound memory: drop emptied buckets
            for k in [k for k, v in _HITS.items() if not v]:
                del _HITS[k]
        return True


def enforce(request: Request | None, bucket: str, *, max_hits: int, window_s: float) -> None:
    """Raise 429 if the client IP exceeded `max_hits` in `window_s` for `bucket`."""
    if not allow(f"{bucket}:{client_ip(request)}", max_hits=max_hits, window_s=window_s):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Please wait a minute and try again.",
        )
