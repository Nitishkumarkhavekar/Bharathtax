"""Client for the self-hosted ml-server (bge-m3 embeddings + reranker).

Used at BOTH ingest time (Celery worker) and query time (API), so the heavy
models stay in one process. No model code here — just HTTP.
"""
from __future__ import annotations

import httpx

from app.core.config import settings

_TIMEOUT = httpx.Timeout(600.0)   # CPU embedding of a batch of long sections can be slow
# bge-m3 only attends to its first several thousand tokens, so a giant chunk (e.g. a
# whole-document parent from a large OCR'd doc — one hit 123k chars) adds no signal but
# grinds CPU embedding for minutes. Cap input length: the head carries the identity.
_MAX_EMBED_CHARS = 8000


def embed(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    texts = [t[:_MAX_EMBED_CHARS] for t in texts]
    with httpx.Client(timeout=_TIMEOUT) as client:
        r = client.post(f"{settings.ml_server_url}/embed", json={"texts": texts})
        r.raise_for_status()
        return r.json()["embeddings"]


def embed_one(text: str) -> list[float]:
    return embed([text])[0]


def rerank(query: str, passages: list[str], top_k: int | None = None) -> list[tuple[int, float]]:
    """Return [(original_index, score)] sorted best-first."""
    if not passages:
        return []
    with httpx.Client(timeout=_TIMEOUT) as client:
        r = client.post(
            f"{settings.ml_server_url}/rerank",
            json={"query": query, "passages": passages, "top_k": top_k},
        )
        r.raise_for_status()
        return [(item["index"], item["score"]) for item in r.json()["results"]]
