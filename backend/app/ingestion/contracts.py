"""Shared data contracts that flow through the pipeline stages.

fetch -> FetchedItem -> extract -> text -> parse -> [ParsedUnit] -> chunk -> [Chunk]
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from app.core.enums import ChunkLevel, SourceType


@dataclass
class FetchedItem:
    """One raw artifact pulled from a source (a PDF/HTML file)."""
    source_key: str
    title: str
    doc_type: SourceType
    raw_bytes: bytes
    content_type: str            # application/pdf | text/html | ...
    source_url: str | None = None
    published_date: date | None = None
    checksum: str | None = None  # sha256 of raw_bytes (filled by fetcher)
    origin_path: str | None = None  # manual-drop path, for logging


@dataclass
class ParsedUnit:
    """A node in the legal-structure tree produced by a parser.

    `path` is the ordered breadcrumb of (label, value) pairs, e.g.
    [("Act","Income Tax Act"),("Chapter","VIA"),("Section","80C"),("sub-section","(2)")].
    The chunker turns this into the human breadcrumb string.
    """
    text: str
    level: ChunkLevel
    path: list[tuple[str, str]] = field(default_factory=list)
    # structured citation fields (any may be None)
    act_name: str | None = None
    section_number: str | None = None
    subsection: str | None = None
    clause: str | None = None
    proviso_no: str | None = None
    explanation_no: str | None = None
    rule_number: str | None = None
    subrule: str | None = None
    effective_date: date | None = None
    extra: dict = field(default_factory=dict)


@dataclass
class Chunk:
    """A retrieval/citation unit ready to be embedded and stored."""
    text: str                    # breadcrumb-prefixed body (what we embed)
    body: str                    # raw body without the breadcrumb prefix
    breadcrumb: str
    level: ChunkLevel
    section_number: str | None = None
    subsection: str | None = None
    clause: str | None = None
    proviso_no: str | None = None
    explanation_no: str | None = None
    rule_number: str | None = None
    subrule: str | None = None
    act_name: str | None = None
    effective_date: date | None = None
    extra: dict = field(default_factory=dict)
    # parent-child: index of the parent chunk within the same document batch
    parent_index: int | None = None
