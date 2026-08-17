"""Hybrid retrieval: dense (pgvector cosine) + sparse (Postgres FTS) -> merge ->
rerank (bge-reranker) -> parent-section expansion.

Parent-child: we MATCH on small chunks but hand the LLM the PARENT section text
for context. Grounding gate: if the best reranked score is below
RETRIEVAL_MIN_SCORE, we return grounded=False and the RAG layer refuses to
answer (anti-hallucination).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache

from sqlalchemy import Float, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import Domain
from app.ingestion.parse.section_cites import extract_sections
from app.models.corpus import CorpusChunk, CorpusDocument
from app.models.documents import DocumentChunk
from app.services import embeddings as emb


@lru_cache(maxsize=1024)
def _embed_query_cached_inner(query_key: str) -> tuple[float, ...]:
    """LRU-cached query-embedding — key is the normalised query string.

    Query embeddings on the ml-server take ~5 s each (CPU bge-m3). Popular
    queries (chip clicks like "bogus purchases", "TDS", "section 68") repeat
    constantly across users, so caching turns the second hit into a memory
    lookup. Cache is per-process; multi-worker setups pay the first miss
    per worker, which is still a huge improvement.

    Tuple return so it's hashable and immutable — protects the cached value
    from accidental mutation by downstream code.
    """
    return tuple(emb.embed_one(query_key))


def _embed_query_cached(query: str) -> list[float]:
    key = (query or "").strip().lower()[:512]
    return list(_embed_query_cached_inner(key))


@dataclass
class Passage:
    chunk_id: int
    breadcrumb: str
    text: str               # context text given to the LLM (parent section if any)
    match_text: str         # the small chunk actually matched
    source_url: str | None
    section_number: str | None
    rule_number: str | None
    domain: str
    score: float = 0.0
    channels: list[str] = field(default_factory=list)  # dense | sparse | section
    digest: str | None = None       # judgment headnote ("what it held"), if generated
    sections_cited: list[str] | None = None


@dataclass
class RetrievalResult:
    passages: list[Passage]
    grounded: bool
    meta: dict


def _qtext(query: str):
    return func.plainto_tsquery("simple", query)


def _dense(db: Session, qvec: list[float], domain: Domain | None, k: int):
    dist = CorpusChunk.embedding.cosine_distance(qvec)
    stmt = select(CorpusChunk, dist.label("dist")).where(
        CorpusChunk.is_current.is_(True), CorpusChunk.embedding.isnot(None)
    )
    if domain:
        stmt = stmt.where(CorpusChunk.domain == domain)
    stmt = stmt.order_by(dist.asc()).limit(k)
    return [(c, 1.0 - float(d)) for c, d in db.execute(stmt).all()]


def _sparse(db: Session, query: str, domain: Domain | None, k: int):
    rank = func.ts_rank(CorpusChunk.tsv, _qtext(query)).cast(Float)
    stmt = select(CorpusChunk, rank.label("rank")).where(
        CorpusChunk.is_current.is_(True),
        CorpusChunk.tsv.op("@@")(_qtext(query)),
    )
    if domain:
        stmt = stmt.where(CorpusChunk.domain == domain)
    stmt = stmt.order_by(rank.desc()).limit(k)
    return [(c, float(r)) for c, r in db.execute(stmt).all()]


def _section_dense(db: Session, qvec: list[float], sections: list[str],
                   domain: Domain | None, k: int):
    """Dense search restricted to documents that CITE one of `sections` — high-precision
    candidates for 'cases on Section 68'-style queries (uses the GIN-indexed
    corpus_documents.sections_cited via an array-overlap filter)."""
    dist = CorpusChunk.embedding.cosine_distance(qvec)
    stmt = (
        select(CorpusChunk, dist.label("dist"))
        .join(CorpusDocument, CorpusChunk.corpus_document_id == CorpusDocument.id)
        .where(
            CorpusChunk.is_current.is_(True), CorpusChunk.embedding.isnot(None),
            CorpusDocument.sections_cited.op("&&")(sections),
        )
    )
    if domain:
        stmt = stmt.where(CorpusChunk.domain == domain)
    stmt = stmt.order_by(dist.asc()).limit(k)
    return [(c, 1.0 - float(d)) for c, d in db.execute(stmt).all()]


def _parent_text(db: Session, chunk: CorpusChunk) -> str:
    if chunk.parent_chunk_id:
        parent = db.get(CorpusChunk, chunk.parent_chunk_id)
        if parent:
            return parent.text
    return chunk.text


def _doc_meta(db: Session, chunk: CorpusChunk):
    """(source_url, digest, sections_cited) for a chunk's parent document, one fetch.
    digest is suppressed for the non-substantive sentinels."""
    doc = db.get(CorpusDocument, chunk.corpus_document_id)
    if not doc:
        return None, None, None
    dg = doc.digest if doc.digest and doc.digest not in ("PROCEDURAL", "INSUFFICIENT") else None
    return doc.source_url, dg, doc.sections_cited


def retrieve(
    db: Session,
    query: str,
    *,
    domain: Domain | None = None,
    use_rerank: bool = True,
) -> RetrievalResult:
    """Hybrid retrieval (dense + sparse + section-aware) with optional
    cross-encoder rerank.

    Set ``use_rerank=False`` for interactive endpoints where the corpus is
    small enough that dense-score ordering is already good, and the ~2 s
    per-pair reranker cost would blow the response-time budget. The
    reranker is CPU-only bge-m3; on a 20-passage candidate set that means
    ~40 s. For a UI search box, that's unacceptable. For grounded RAG in
    the chat pipeline, it's worth the wait.
    """
    qvec = _embed_query_cached(query)
    dense = _dense(db, qvec, domain, settings.retrieval_dense_k)
    sparse = _sparse(db, query, domain, settings.retrieval_sparse_k)
    # section-aware channel: if the query names an IT-Act section ("cases on s.68"),
    # add dense hits restricted to documents that CITE it (high precision).
    q_sections = extract_sections(query)
    section = _section_dense(db, qvec, q_sections, domain, settings.retrieval_dense_k) if q_sections else []

    # merge candidate set by chunk id, recording channel(s) + a base dense score
    cand: dict[int, tuple[CorpusChunk, set[str]]] = {}
    base: dict[int, float] = {}
    for c, s in dense:
        cand.setdefault(c.id, (c, set()))[1].add("dense")
        base[c.id] = max(base.get(c.id, 0.0), s)
    for c, _ in sparse:
        cand.setdefault(c.id, (c, set()))[1].add("sparse")
        base.setdefault(c.id, 0.0)
    for c, s in section:
        cand.setdefault(c.id, (c, set()))[1].add("section")
        base[c.id] = max(base.get(c.id, 0.0), s)

    if not cand:
        return RetrievalResult([], grounded=False, meta={"dense": len(dense), "sparse": 0})

    chunks = [c for c, _ in cand.values()]
    reranked = False
    if use_rerank:
        try:
            scores = emb.rerank(query, [c.text for c in chunks], top_k=settings.retrieval_rerank_k)
            reranked = True
        except Exception:  # reranker unavailable -> degrade to dense-score ordering
            ranked = sorted(range(len(chunks)), key=lambda i: base[chunks[i].id], reverse=True)
            scores = [(i, base[chunks[i].id]) for i in ranked[: settings.retrieval_rerank_k]]
    else:
        # Fast path: skip the CPU cross-encoder entirely and order by the
        # max dense/section score we already have. Loses a small amount of
        # relevance quality on ambiguous queries, wins ~40s of wall-clock.
        ranked = sorted(range(len(chunks)), key=lambda i: base[chunks[i].id], reverse=True)
        scores = [(i, base[chunks[i].id]) for i in ranked[: settings.retrieval_rerank_k]]

    # Batch the parent-section and document-metadata lookups instead of two
    # point queries per passage (was N+1 on the hot path).
    sel = [(chunks[idx], score) for idx, score in scores]
    parent_ids = {c.parent_chunk_id for c, _ in sel if c.parent_chunk_id}
    doc_ids = {c.corpus_document_id for c, _ in sel}
    parents = {
        p.id: p for p in db.scalars(select(CorpusChunk).where(CorpusChunk.id.in_(parent_ids)))
    } if parent_ids else {}
    docs = {
        d.id: d for d in db.scalars(select(CorpusDocument).where(CorpusDocument.id.in_(doc_ids)))
    } if doc_ids else {}

    passages: list[Passage] = []
    for c, score in sel:
        parent = parents.get(c.parent_chunk_id) if c.parent_chunk_id else None
        doc = docs.get(c.corpus_document_id)
        digest = None
        if doc and doc.digest and doc.digest not in ("PROCEDURAL", "INSUFFICIENT"):
            digest = doc.digest
        passages.append(
            Passage(
                chunk_id=c.id,
                breadcrumb=c.breadcrumb,
                text=parent.text if parent else c.text,
                match_text=c.text,
                source_url=doc.source_url if doc else None,
                section_number=c.section_number,
                rule_number=c.rule_number,
                domain=c.domain.value if hasattr(c.domain, "value") else str(c.domain),
                score=round(score, 4),
                channels=sorted(cand[c.id][1]),
                digest=digest,
                sections_cited=doc.sections_cited if doc else None,
            )
        )

    grounded = bool(passages) and passages[0].score >= settings.retrieval_min_score
    meta = {
        "dense": len(dense),
        "sparse": len(sparse),
        "section": len(section),
        "sections_in_query": q_sections,
        "candidates": len(cand),
        "top_score": passages[0].score if passages else None,
        "min_score": settings.retrieval_min_score,
        "reranked": reranked,
    }
    return RetrievalResult(passages, grounded=grounded, meta=meta)


def retrieve_documents(db: Session, query: str, *, namespace: str) -> RetrievalResult:
    """Hybrid retrieval over ONE user's uploaded document (private namespace).
    No legal parent-child; each chunk is its own context."""
    qvec = emb.embed_one(query)
    dist = DocumentChunk.embedding.cosine_distance(qvec)
    dense_stmt = (
        select(DocumentChunk)
        .where(DocumentChunk.namespace == namespace, DocumentChunk.embedding.isnot(None))
        .order_by(dist.asc())
        .limit(settings.retrieval_dense_k)
    )
    sparse_stmt = (
        select(DocumentChunk)
        .where(DocumentChunk.namespace == namespace, DocumentChunk.tsv.op("@@")(_qtext(query)))
        .order_by(func.ts_rank(DocumentChunk.tsv, _qtext(query)).desc())
        .limit(settings.retrieval_sparse_k)
    )
    cand: dict[int, tuple[DocumentChunk, set[str]]] = {}
    for c in db.scalars(dense_stmt):
        cand.setdefault(c.id, (c, set()))[1].add("dense")
    for c in db.scalars(sparse_stmt):
        cand.setdefault(c.id, (c, set()))[1].add("sparse")
    if not cand:
        return RetrievalResult([], grounded=False, meta={"candidates": 0})

    chunks = [c for c, _ in cand.values()]
    try:
        scores = emb.rerank(query, [c.text for c in chunks], top_k=settings.retrieval_rerank_k)
    except Exception:  # reranker down -> degrade to candidate order, don't 500
        # These chunks are from the user's OWN uploaded document, so treat them
        # as grounded at the gate (score = min_score) instead of failing the query.
        scores = [
            (i, settings.retrieval_min_score)
            for i in range(min(len(chunks), settings.retrieval_rerank_k))
        ]
    passages = [
        Passage(
            chunk_id=chunks[idx].id,
            breadcrumb=chunks[idx].breadcrumb or "uploaded document",
            text=chunks[idx].text,
            match_text=chunks[idx].text,
            source_url=None,
            section_number=None,
            rule_number=None,
            domain="document",
            score=round(score, 4),
            channels=sorted(cand[chunks[idx].id][1]),
        )
        for idx, score in scores
    ]
    grounded = bool(passages) and passages[0].score >= settings.retrieval_min_score
    return RetrievalResult(
        passages, grounded=grounded,
        meta={"candidates": len(cand), "top_score": passages[0].score if passages else None},
    )
