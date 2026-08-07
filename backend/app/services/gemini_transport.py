"""Backend-agnostic transport for Gemini generateContent calls.

Two backends, one env flag ``GEMINI_BACKEND``:

* ``aistudio`` (default) — AI Studio Gemini API
  (``generativelanguage.googleapis.com``), authed with an API key.
  This is what BharathTax has always used. **Not** covered by the Google
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

import logging
import os
import threading
import time

log = logging.getLogger("gemini_transport")

_BACKEND = os.getenv("GEMINI_BACKEND", "aistudio").strip().lower()

# --- AI Studio (default) -------------------------------------------------
_AISTUDIO_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_KEY = os.getenv("GEMINI_API_KEY", "").strip()

# --- Vertex --------------------------------------------------------------
_VERTEX_PROJECT = os.getenv("GEMINI_VERTEX_PROJECT", "").strip()
_VERTEX_LOCATION = os.getenv("GEMINI_VERTEX_LOCATION", "asia-south1").strip()
_VERTEX_API_VERSION = os.getenv("GEMINI_VERTEX_API_VERSION", "v1").strip()
_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

# AI Studio model ids (incl. "-latest" aliases) → concrete Vertex model ids.
# Vertex has no "-latest" aliases and no gemini-3.5-* line, so map them onto
# the current 2.5 tier. Override with GEMINI_VERTEX_MODEL_MAP="a=b,c=d".
_DEFAULT_MODEL_MAP = {
    "gemini-flash-latest": "gemini-2.5-flash",
    "gemini-flash-lite-latest": "gemini-2.5-flash-lite",
    "gemini-pro-latest": "gemini-2.5-pro",
    "gemini-3.5-flash": "gemini-2.5-flash",
    "gemini-3.5-flash-lite": "gemini-2.5-flash-lite",
    "gemini-2.5-flash": "gemini-2.5-flash",
    "gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
    "gemini-2.5-pro": "gemini-2.5-pro",
    "gemini-2.0-flash": "gemini-2.0-flash",
}


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


def _access_token() -> str:
    """Return a valid bearer token, refreshing (thread-safely) when stale."""
    global _token_value, _token_exp
    with _lock:
        now = time.time()
        if _token_value and now < _token_exp - 60:
            return _token_value
        from google.auth.transport.requests import Request
        creds = _load_credentials()
        creds.refresh(Request())
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
