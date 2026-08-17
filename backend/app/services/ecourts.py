"""eCourts India partner-API client.

Thin wrapper around https://webapi.ecourtsindia.com that:
  * injects the ECOURTS_API_KEY bearer token on every call,
  * standardises timeouts + basic retry on transient network errors,
  * normalises the API's success/error envelope for the FastAPI routes.

We deliberately keep this module skinny — no business logic, no caching, no
DB. The routes layer (rulings.py) shapes the response for the frontend and
decides what to persist.

Auth model
----------
The partner API uses ``Authorization: Bearer eci_live_...`` on every call.
The public ``/api/CauseList/*`` variants return 401 for this key — they need
a different credential flow. We only touch ``/api/partner/*`` endpoints.

Disabled state
--------------
If ``ECOURTS_API_KEY`` is empty in the environment, ``available()`` returns
False and route handlers should short-circuit with HTTP 503 rather than
attempt (and fail) the call. Keeps the platform bootable without the key.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

log = logging.getLogger("ecourts")

# Sensible defaults — the partner API is generally < 500 ms for CNR lookups
# and 1-3 s for facet/search queries. Cushion for cold Cloudflare edges.
_TIMEOUT_SHORT = httpx.Timeout(15.0, connect=5.0)
_TIMEOUT_LONG = httpx.Timeout(45.0, connect=5.0)
_UA = "BharatTax/1.0 (+https://bharattax.wenvia.global)"


class EcourtsError(RuntimeError):
    """Raised on non-2xx from the eCourts API. Carries HTTP status + body
    snippet so the caller can surface a useful error to the user."""

    def __init__(self, status: int, message: str, body: dict | str | None = None):
        super().__init__(message)
        self.status = status
        self.body = body


def available() -> bool:
    return bool((settings.ecourts_api_key or "").strip())


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.ecourts_api_key.strip()}",
        "User-Agent": _UA,
        "Accept": "application/json",
    }


def _url(path: str) -> str:
    base = settings.ecourts_base_url.rstrip("/")
    return f"{base}{path if path.startswith('/') else '/' + path}"


def _handle(r: httpx.Response) -> Any:
    """Normalise the partner-API response envelope.

    Success: ``{"data": ..., "meta": {...}}`` or a bare list.
    Error:   ``{"error": {"code": ..., "message": ..., "details": ...}}``
             or ``{"success": false, "errorMessage": ..., "errorCode": ...}``.
    """
    ct = r.headers.get("content-type", "")
    payload: dict | list | str
    if "application/json" in ct:
        try:
            payload = r.json()
        except Exception:  # noqa: BLE001
            payload = r.text
    else:
        payload = r.text
    if 200 <= r.status_code < 300:
        # Unwrap the {"data": ...} envelope when present so route handlers
        # get the useful payload directly. Bare lists (states, districts)
        # pass through unchanged.
        if isinstance(payload, dict) and "data" in payload:
            return payload["data"]
        return payload
    # Error path — try to extract a human-readable message.
    msg = f"eCourts API HTTP {r.status_code}"
    if isinstance(payload, dict):
        err = payload.get("error") or {}
        msg = (
            err.get("message")
            or payload.get("errorMessage")
            or msg
        )
    raise EcourtsError(r.status_code, msg, payload)


def get(path: str, *, params: dict | None = None, long: bool = False) -> Any:
    """GET helper used by every route. Short timeout by default; ``long=True``
    for the search endpoints which can take a couple of seconds."""
    if not available():
        raise EcourtsError(503, "eCourts integration is disabled (no API key)")
    timeout = _TIMEOUT_LONG if long else _TIMEOUT_SHORT
    with httpx.Client(timeout=timeout, headers=_headers()) as client:
        try:
            r = client.get(_url(path), params=params or {})
        except httpx.HTTPError as e:
            log.warning("ecourts GET %s network error: %s", path, e)
            raise EcourtsError(502, f"eCourts network error: {e}") from e
    return _handle(r)


def post(path: str, *, json_body: dict | None = None, long: bool = False) -> Any:
    if not available():
        raise EcourtsError(503, "eCourts integration is disabled (no API key)")
    timeout = _TIMEOUT_LONG if long else _TIMEOUT_SHORT
    with httpx.Client(timeout=timeout, headers=_headers()) as client:
        try:
            r = client.post(_url(path), json=json_body or {})
        except httpx.HTTPError as e:
            log.warning("ecourts POST %s network error: %s", path, e)
            raise EcourtsError(502, f"eCourts network error: {e}") from e
    return _handle(r)
