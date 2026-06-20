"""Self-hosted model server: bge-m3 dense embeddings + bge-reranker-v2-m3.

Exposed over HTTP so the API (query-time) and the Celery worker (ingest-time)
share ONE loaded copy of each model instead of duplicating ~1 GB per process —
important on a 16 GB CPU box. Models load lazily on first request.

Endpoints:
  GET  /health
  POST /embed    {texts: [...], normalize?: bool}        -> {embeddings: [[...]], dim}
  POST /rerank   {query: str, passages: [...], top_k?}   -> {results: [{index, score}]}
"""
from __future__ import annotations

import os
from functools import lru_cache

from fastapi import FastAPI
from pydantic import BaseModel

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-m3")
RERANKER_MODEL = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
DEVICE = os.getenv("ML_DEVICE", "cpu")
USE_FP16 = DEVICE != "cpu"  # fp16 only helps on GPU

app = FastAPI(title="TaxMedha ML Server")


@lru_cache(maxsize=1)
def _embedder():
    from FlagEmbedding import BGEM3FlagModel

    return BGEM3FlagModel(EMBEDDING_MODEL, use_fp16=USE_FP16, device=DEVICE)


@lru_cache(maxsize=1)
def _reranker():
    from FlagEmbedding import FlagReranker

    return FlagReranker(RERANKER_MODEL, use_fp16=USE_FP16, device=DEVICE)


class EmbedRequest(BaseModel):
    texts: list[str]
    normalize: bool = True


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    dim: int


class RerankRequest(BaseModel):
    query: str
    passages: list[str]
    top_k: int | None = None


class RerankResult(BaseModel):
    index: int
    score: float


class RerankResponse(BaseModel):
    results: list[RerankResult]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "embedding_model": EMBEDDING_MODEL, "device": DEVICE}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest) -> EmbedResponse:
    out = _embedder().encode(
        req.texts, return_dense=True, return_sparse=False, return_colbert_vecs=False
    )
    dense = out["dense_vecs"]
    vectors = [v.tolist() for v in dense]
    return EmbedResponse(embeddings=vectors, dim=len(vectors[0]) if vectors else 0)


@app.post("/rerank", response_model=RerankResponse)
def rerank(req: RerankRequest) -> RerankResponse:
    if not req.passages:
        return RerankResponse(results=[])
    pairs = [[req.query, p] for p in req.passages]
    scores = _reranker().compute_score(pairs, normalize=True)
    if isinstance(scores, float):
        scores = [scores]
    ranked = sorted(
        ({"index": i, "score": float(s)} for i, s in enumerate(scores)),
        key=lambda r: r["score"],
        reverse=True,
    )
    if req.top_k is not None:
        ranked = ranked[: req.top_k]
    return RerankResponse(results=[RerankResult(**r) for r in ranked])
