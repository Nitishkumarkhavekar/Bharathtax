"""Workstream B corpus: sources (from sources.yaml) > documents (raw+text) >
chunks (text + breadcrumb + dense vector + sparse tsvector + metadata).

Key design points baked in here:
  * domain  -> the 'Module' axis (income_tax | gst | ...)
  * parent-child -> match on small child chunks, give the LLM the parent section
  * versioning by effective_date -> amendments add rows; superseded text is kept
  * raw file in MinIO + extracted_text in DB -> re-chunk without re-fetching
"""
from __future__ import annotations

from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean, Computed, Date, DateTime, ForeignKey, Index, Integer, String, Text, func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.core.db import Base
from app.models.enums import ChunkLevel, CorpusDocStatus, Domain, SourceType


class CorpusSource(Base):
    """One entry per `sources.yaml` source; upserted by the registry loader."""
    __tablename__ = "corpus_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(100), unique=True)     # e.g. it_act_1961
    domain: Mapped[Domain] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(300))
    source_type: Mapped[SourceType] = mapped_column()
    base_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)       # raw yaml entry
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    documents: Mapped[list["CorpusDocument"]] = relationship(back_populates="source")


class CorpusDocument(Base):
    """A fetched unit (a section page, a circular PDF). Keeps BOTH the raw file
    (MinIO key) and the extracted clean text, so we can re-chunk/re-embed later."""
    __tablename__ = "corpus_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("corpus_sources.id"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    doc_type: Mapped[SourceType] = mapped_column()
    source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    raw_minio_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    checksum: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)  # dedup/delta
    published_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[CorpusDocStatus] = mapped_column(default=CorpusDocStatus.fetched)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    source: Mapped[CorpusSource] = relationship(back_populates="documents")
    chunks: Mapped[list["CorpusChunk"]] = relationship(back_populates="document")


class CorpusChunk(Base):
    """The unit of retrieval AND the citation record. Never blind fixed-size:
    produced by the structure-aware chunker on section/sub-section boundaries."""
    __tablename__ = "corpus_chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    corpus_document_id: Mapped[int] = mapped_column(ForeignKey("corpus_documents.id"), index=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("corpus_sources.id"), index=True)
    domain: Mapped[Domain] = mapped_column(index=True)

    # content (text is stored breadcrumb-prefixed for embedding context)
    text: Mapped[str] = mapped_column(Text)
    breadcrumb: Mapped[str] = mapped_column(String(600))
    chunk_level: Mapped[ChunkLevel] = mapped_column(default=ChunkLevel.section)
    parent_chunk_id: Mapped[int | None] = mapped_column(
        ForeignKey("corpus_chunks.id"), nullable=True, index=True
    )

    # structured citation metadata (queryable columns + free-form jsonb)
    act_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    section_number: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)
    subsection: Mapped[str | None] = mapped_column(String(50), nullable=True)
    clause: Mapped[str | None] = mapped_column(String(50), nullable=True)
    proviso_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    explanation_no: Mapped[str | None] = mapped_column(String(50), nullable=True)
    rule_number: Mapped[str | None] = mapped_column(String(50), index=True, nullable=True)
    subrule: Mapped[str | None] = mapped_column(String(50), nullable=True)
    extra: Mapped[dict] = mapped_column(JSONB, default=dict)

    # search indexes
    embedding: Mapped[list[float] | None] = mapped_column(Vector(settings.embedding_dim), nullable=True)
    # sparse channel: Postgres FTS. 'simple' config (no stemming) keeps section
    # numbers / citations exact. Auto-maintained generated column — never written by the app.
    tsv: Mapped[str | None] = mapped_column(
        TSVECTOR, Computed("to_tsvector('simple', coalesce(text, ''))", persisted=True), nullable=True
    )

    # versioning by effective date — amendments add rows, never overwrite
    effective_date: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)
    superseded_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    supersedes_id: Mapped[int | None] = mapped_column(ForeignKey("corpus_chunks.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    document: Mapped[CorpusDocument] = relationship(back_populates="chunks")

    __table_args__ = (
        # dense: HNSW cosine (semantic search)
        Index(
            "ix_corpus_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        # sparse: GIN on tsvector (exact keyword/citation lookup)
        Index("ix_corpus_chunks_tsv_gin", "tsv", postgresql_using="gin"),
    )
