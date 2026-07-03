"""Hybrid retrieval: dense (pgvector cosine) + sparse (Postgres FTS) -> merge ->
rerank (bge-reranker) -> parent-section expansion.

Parent-child: we MATCH on small chunks but hand the LLM the PARENT section text
for context. Grounding gate: if the best reranked score is below
RETRIEVAL_MIN_SCORE, we return grounded=False and the RAG layer refuses to
answer (anti-hallucination).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import Float, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.enums import Domain
from app.ingestion.parse.section_cites import extract_sections
from app.models.corpus import CorpusChunk, CorpusDocument
from app.models.documents import DocumentChunk
from app.services import embeddings as emb


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
    channels: list[str] = field(default_factory=list)  # dense | sparse


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


def _source_url(db: Session, chunk: CorpusChunk) -> str | None:
    doc = db.get(CorpusDocument, chunk.corpus_document_id)
    return doc.source_url if doc else None


def retrieve(db: Session, query: str, *, domain: Domain | None = None) -> RetrievalResult:
    qvec = emb.embed_one(query)
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
    reranked = True
    try:
        scores = emb.rerank(query, [c.text for c in chunks], top_k=settings.retrieval_rerank_k)
    except Exception:  # reranker unavailable -> degrade to dense-score ordering
        reranked = False
        ranked = sorted(range(len(chunks)), key=lambda i: base[chunks[i].id], reverse=True)
        scores = [(i, base[chunks[i].id]) for i in ranked[: settings.retrieval_rerank_k]]

    passages: list[Passage] = []
    for idx, score in scores:
        c = chunks[idx]
        passages.append(
            Passage(
                chunk_id=c.id,
                breadcrumb=c.breadcrumb,
                text=_parent_text(db, c),
                match_text=c.text,
                source_url=_source_url(db, c),
                section_number=c.section_number,
                rule_number=c.rule_number,
                domain=c.domain.value if hasattr(c.domain, "value") else str(c.domain),
                score=round(score, 4),
                channels=sorted(cand[c.id][1]),
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
    scores = emb.rerank(query, [c.text for c in chunks], top_k=settings.retrieval_rerank_k)
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
