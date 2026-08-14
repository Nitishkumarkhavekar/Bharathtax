"""Backend-agnostic transport for Gemini generateContent calls.

Two backends, one env flag ``GEMINI_BACKEND``:

* ``aistudio`` (default) — AI Studio Gemini API
  (``generativelanguage.googleapis.com``), authed with an API key.
  This is what BharatTax has always used. **Not** covered by the Google
  Cloud $300 free-trial credit (excluded since March 2026).

* ``vertex`` — Vertex AI Gemini
  (``{location}-aiplatform.googleapis.com``), authed with an OAuth bearer
  token minted from a service-account JSON. Same Gemini models, same
  request/response proto — but **is** covered by the $300 free credit.

Every Gemini caller routes URL construction + auth headers + model-name
mapping through here, so switching the whole app between paid AI Studio and
free-credit Vertex is a single env flip with zero code change.

Required env for ``vertex`` mode
--------------------------------
* ``GEMINI_BACKEND=vertex``
* ``GEMINI_VERTEX_PROJECT`` — the GCP project id (e.g. gen-lang-client-…)
* ``GEMINI_VERTEX_LOCATION`` — region, default ``asia-south1`` (Mumbai);
  ``global`` is also valid for models that require it.
* ``GOOGLE_APPLICATION_CREDENTIALS`` — path to the service-account JSON
  (falls back to Application Default Credentials if unset).
"""
from __future__ import annotations

import collections
import logging
import os
import threading
import time

log = logging.getLogger("gemini_transport")

_BACKEND = os.getenv("GEMINI_BACKEND", "aistudio").strip().lower()

# ---------------------------------------------------------------------------
# Rate-limiting gate
# ---------------------------------------------------------------------------
# Vertex's `global` endpoint on newer Gemini models runs under Dynamic Shared
# Quota — no per-project RPM to raise. Bursts of parallel /ask requests trip
# the shared pool and produce 429 → 10s-sleep → retry → fallback-to-2.5-pro
# spikes (measured 30-90s vs the 8-15s cache-warm baseline).
#
# This gate limits our OWN burst behaviour so we never present the DSQ pool
# with more than N concurrent calls or more than M calls/minute. Two knobs:
#   * VERTEX_MAX_CONCURRENT — cap on in-flight Vertex requests (default 6).
#   * VERTEX_MAX_RPM        — soft cap on calls per rolling 60s (default 50).
# Both live in gemini_transport so any caller that opts in (`with _tx.gate():
# ...`) inherits the same limits — one place, one policy.
_MAX_CONCURRENT = int(os.getenv("VERTEX_MAX_CONCURRENT", "6"))
_MAX_RPM = int(os.getenv("VERTEX_MAX_RPM", "50"))
_semaphore = threading.Semaphore(_MAX_CONCURRENT)
_rate_lock = threading.Lock()
_recent_calls: collections.deque[float] = collections.deque(maxlen=_MAX_RPM)
_gate_stats = {"acquired": 0, "waited_ms_total": 0, "rpm_holds": 0}


class _Gate:
    """Context manager that spaces our own Vertex calls so the DSQ shared
    pool never sees more than _MAX_CONCURRENT parallel from us at once, and
    never more than _MAX_RPM in any rolling 60-second window. Waits (does
    not fail) when either cap is hit."""

    def __enter__(self) -> "_Gate":
        t0 = time.time()
        _semaphore.acquire()
        # RPM window check — hold until oldest slot is >60s old.
        with _rate_lock:
            now = time.time()
            if len(_recent_calls) == _MAX_RPM:
                oldest = _recent_calls[0]
                wait = 60.0 - (now - oldest)
                if wait > 0:
                    _gate_stats["rpm_holds"] += 1
                    log.info("rate-gate: RPM window full, sleeping %.2fs", wait)
                    time.sleep(wait + 0.05)
                    now = time.time()
            _recent_calls.append(now)
        _gate_stats["acquired"] += 1
        waited = int((time.time() - t0) * 1000)
        _gate_stats["waited_ms_total"] += waited
        return self

    def __exit__(self, *_exc):
        _semaphore.release()


def gate() -> _Gate:
    """Return a context manager that reserves one Vertex call slot. Use
    around every httpx call to a Vertex endpoint: `with _tx.gate(): ...`."""
    return _Gate()


def gate_stats() -> dict:
    """Diagnostics for /health-style endpoints."""
    return dict(_gate_stats)

# --- AI Studio (default) -------------------------------------------------
_AISTUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_KEY = os.getenv("GEMINI_API_KEY", "").strip()

# --- Vertex --------------------------------------------------------------
_VERTEX_PROJECT = os.getenv("GEMINI_VERTEX_PROJECT", "").strip()
_VERTEX_LOCATION = os.getenv("GEMINI_VERTEX_LOCATION", "asia-south1").strip()
_VERTEX_API_VERSION = os.getenv("GEMINI_VERTEX_API_VERSION", "v1").strip()
_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

# Model-name mapping AI Studio → Vertex. Vertex's `global` endpoint serves the
# very same model ids the app already uses — including the "-latest" aliases
# and the gemini-3.5-* line — so the map is EMPTY by default (identity): the
# exact same model answers on Vertex as on AI Studio, no quality change.
#
# It stays a hook only for the rare model that a chosen region genuinely lacks
# (e.g. the -lite models are absent in asia-south1 — but we run in `global`,
# where they exist). Override per-deployment with GEMINI_VERTEX_MODEL_MAP="a=b,c=d".
_DEFAULT_MODEL_MAP: dict[str, str] = {}


def _parse_map_override() -> dict[str, str]:
    raw = os.getenv("GEMINI_VERTEX_MODEL_MAP", "").strip()
    out: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if "=" in pair:
            k, v = pair.split("=", 1)
            if k.strip() and v.strip():
                out[k.strip()] = v.strip()
    return out


_MODEL_MAP = {**_DEFAULT_MODEL_MAP, **_parse_map_override()}


# --- OAuth token cache (vertex only) -------------------------------------
_lock = threading.Lock()
_creds = None            # cached google.auth credentials object
_token_value: str | None = None
_token_exp: float = 0.0


def _load_credentials():
    global _creds
    if _creds is not None:
        return _creds
    path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if path and os.path.exists(path):
        from google.oauth2 import service_account
        _creds = service_account.Credentials.from_service_account_file(
            path, scopes=_SCOPES)
    else:
        import google.auth  # Application Default Credentials fallback
        _creds, _ = google.auth.default(scopes=_SCOPES)
    return _creds


class _HttpxAuthRequest:
    """Minimal ``google.auth.transport.Request`` implemented on httpx.

    google-auth's stock transports pull in the ``requests`` or ``urllib3``
    packages; httpx is already a project dependency, so we adapt it and add
    nothing new. The interface google-auth calls: ``(url, method, body,
    headers, timeout)`` → object exposing ``.status``, ``.headers``, ``.data``.
    """

    def __call__(self, url, method="GET", body=None, headers=None,
                 timeout=None, **kwargs):
        import httpx
        r = httpx.request(method, url, content=body, headers=headers,
                          timeout=timeout or 120.0)

        class _Resp:
            status = r.status_code
            data = r.content
        _Resp.headers = r.headers
        return _Resp()


def _access_token() -> str:
    """Return a valid bearer token, refreshing (thread-safely) when stale."""
    global _token_value, _token_exp
    with _lock:
        now = time.time()
        if _token_value and now < _token_exp - 60:
            return _token_value
        creds = _load_credentials()
        creds.refresh(_HttpxAuthRequest())
        _token_value = creds.token
        exp = getattr(creds, "expiry", None)
        if exp is not None:
            import calendar
            _token_exp = calendar.timegm(exp.utctimetuple())
        else:
            _token_exp = now + 3000
        return _token_value


# --- public API ----------------------------------------------------------
def backend() -> str:
    return _BACKEND


def is_vertex() -> bool:
    return _BACKEND == "vertex"


def available() -> bool:
    """Whether the configured backend has the credentials it needs.

    Replaces the old ``bool(GEMINI_API_KEY)`` gate so ``enabled()`` checks
    work identically for both backends.
    """
    if _BACKEND == "vertex":
        return bool(_VERTEX_PROJECT)
    return bool(_KEY)


def map_model(model: str) -> str:
    if _BACKEND != "vertex":
        return model
    return _MODEL_MAP.get(model, model)


def url(model: str, method: str) -> str:
    """Full endpoint for ``{model}:{method}`` on the active backend.

    ``method`` is e.g. ``"generateContent"`` or ``"streamGenerateContent"``.
    Callers that stream append ``"?alt=sse"`` to the result themselves.
    """
    m = map_model(model)
    if _BACKEND == "vertex":
        loc = _VERTEX_LOCATION
        host = ("aiplatform.googleapis.com" if loc == "global"
                else f"{loc}-aiplatform.googleapis.com")
        return (f"https://{host}/{_VERTEX_API_VERSION}/projects/{_VERTEX_PROJECT}"
                f"/locations/{loc}/publishers/google/models/{m}:{method}")
    return f"{_AISTUDIO_BASE}/{m}:{method}"


def headers() -> dict:
    """Auth + content-type headers for the active backend."""
    if _BACKEND == "vertex":
        return {"Authorization": f"Bearer {_access_token()}",
                "Content-Type": "application/json"}
    return {"x-goog-api-key": _KEY, "Content-Type": "application/json"}


def endpoint_host() -> str:
    """Display host for the active backend (for health probes / dashboards)."""
    if _BACKEND == "vertex":
        loc = _VERTEX_LOCATION
        return ("aiplatform.googleapis.com" if loc == "global"
                else f"{loc}-aiplatform.googleapis.com")
    return "generativelanguage.googleapis.com"


def search_tool() -> dict:
    """Google Search grounding tool, spelled the way each backend expects.

    Proto-JSON accepts both spellings, but we use the canonical one per
    backend to stay safe across API versions.
    """
    if _BACKEND == "vertex":
        return {"googleSearch": {}}
    return {"google_search": {}}
