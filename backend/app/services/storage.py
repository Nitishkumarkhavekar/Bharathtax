"""Object-storage helper.

Since the migration (Nov 2025) **Cloudflare R2 is the sole store** for raw
source files and uploaded appeal PDFs. R2 speaks the S3 protocol, and the
`minio-py` client we already had installed talks to it with SigV4 auth —
no new dependency required.

MinIO is intentionally left in the compose file for a short cooldown period
so we can spot-check anything historic. Nothing writes there any more.

The public API (`put_bytes`, `get_bytes`, `ensure_bucket`) is unchanged, so
call sites elsewhere in the codebase keep working with zero changes.
"""
from __future__ import annotations

import io
from datetime import timedelta
from functools import lru_cache

from minio import Minio

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)


def _r2_configured() -> bool:
    return bool(
        settings.r2_endpoint
        and settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_bucket_raw
    )


@lru_cache(maxsize=1)
def _r2_client() -> Minio:
    """R2 client. Cached so we reuse the underlying httpx pool."""
    return Minio(
        settings.r2_endpoint,
        access_key=settings.r2_access_key_id,
        secret_key=settings.r2_secret_access_key,
        secure=True,
        region=settings.r2_region or "auto",
    )


@lru_cache(maxsize=1)
def _legacy_minio_client() -> Minio:
    """Legacy MinIO client — retained only so a very old call site that
    somehow passes a MinIO-flavoured bucket name still works. Never used
    for new writes."""
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
        region=settings.minio_region,
    )


def get_client() -> Minio:
    """Backwards-compatible accessor. Returns the R2 client when configured,
    falls back to the legacy MinIO client only if R2 env is missing."""
    if _r2_configured():
        return _r2_client()
    return _legacy_minio_client()


def _default_bucket() -> str:
    """Bucket for the current backend."""
    if _r2_configured():
        return settings.r2_bucket_raw
    return settings.minio_bucket_raw


def ensure_bucket(bucket: str | None = None) -> str:
    """No-op for R2 — the bucket is created out-of-band via the Cloudflare
    dashboard and this token has Object-scope, not Admin-scope, so bucket
    creation isn't (and shouldn't be) available at runtime. Kept for API
    compatibility with the older MinIO helper."""
    b = bucket or _default_bucket()
    if not _r2_configured():
        # Preserve the old MinIO auto-create behaviour for dev boxes.
        client = _legacy_minio_client()
        if not client.bucket_exists(b):
            client.make_bucket(b)
            log.info("created MinIO bucket %s", b)
    return b


def put_bytes(key: str, data: bytes,
              content_type: str = "application/octet-stream",
              bucket: str | None = None) -> str:
    """Upload bytes under `key` in the raw bucket. Returns the key."""
    b = ensure_bucket(bucket)
    get_client().put_object(
        b, key, io.BytesIO(data), length=len(data), content_type=content_type,
    )
    return key


def get_bytes(key: str, bucket: str | None = None) -> bytes:
    """Fetch bytes for `key`. Reads from R2 when configured."""
    b = bucket or _default_bucket()
    resp = get_client().get_object(b, key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


def presigned_get_url(key: str, *, expires_seconds: int | None = None,
                      bucket: str | None = None) -> str:
    """Signed HTTPS URL that gives temporary anonymous read access to `key`.
    The browser hits R2 directly with this URL — bypassing our VPS's
    bandwidth entirely on PDF downloads (a real win at 50-user scale).

    Only supported when R2 is configured; on the legacy MinIO path it returns
    a signed URL against the internal MinIO endpoint which isn't public — so
    the caller should keep proxying through the api instead in that case.
    """
    b = bucket or _default_bucket()
    ttl = expires_seconds or settings.r2_signed_url_ttl_seconds
    return get_client().presigned_get_object(b, key, expires=timedelta(seconds=ttl))


def remove_object(key: str, bucket: str | None = None) -> None:
    """Delete an object. Silently no-ops on 404 — a re-delete during a
    partial-failure retry shouldn't itself raise."""
    b = bucket or _default_bucket()
    try:
        get_client().remove_object(b, key)
    except Exception as exc:  # noqa: BLE001
        log.warning("remove_object(%s/%s) failed: %s", b, key, exc)
