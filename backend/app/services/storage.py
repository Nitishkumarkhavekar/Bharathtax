"""MinIO object storage helper. Raw source files and uploaded documents are kept
here (the brief: always retain the raw file so we can re-chunk without re-fetch)."""
from __future__ import annotations

import io
from functools import lru_cache

from minio import Minio

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)


@lru_cache(maxsize=1)
def get_client() -> Minio:
    return Minio(
        settings.minio_endpoint,
        access_key=settings.minio_access_key,
        secret_key=settings.minio_secret_key,
        secure=settings.minio_secure,
        region=settings.minio_region,
    )


def ensure_bucket(bucket: str | None = None) -> str:
    bucket = bucket or settings.minio_bucket_raw
    client = get_client()
    if not client.bucket_exists(bucket):
        client.make_bucket(bucket)
        log.info("created bucket %s", bucket)
    return bucket


def put_bytes(key: str, data: bytes, content_type: str = "application/octet-stream",
              bucket: str | None = None) -> str:
    bucket = ensure_bucket(bucket)
    get_client().put_object(
        bucket, key, io.BytesIO(data), length=len(data), content_type=content_type
    )
    return key


def get_bytes(key: str, bucket: str | None = None) -> bytes:
    bucket = bucket or settings.minio_bucket_raw
    resp = get_client().get_object(bucket, key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()
