"""Structure-aware chunker.

Consumes the parser's ordered ParsedUnit stream and emits Chunk records:
  * one PARENT chunk per section/rule (full text) -> given to the LLM for context
  * CHILD chunks per sub-section / proviso / Explanation / paragraph -> matched on
Each chunk is prefixed with its location breadcrumb (so the embedding carries
context, and the citation is self-describing). Boundaries come from the parser,
so a proviso or Explanation is never split mid-unit. There is NO blind
fixed-size windowing here.
"""
from __future__ import annotations

from collections.abc import Iterable

from app.ingestion.contracts import Chunk, ParsedUnit
from app.core.enums import ChunkLevel

_BARE_LABELS = {"Act", "Circular", "Notification"}


def build_breadcrumb(path: list[tuple[str, str]]) -> str:
    parts: list[str] = []
    for label, value in path:
        parts.append(value if label in _BARE_LABELS else f"{label} {value}")
    return " > ".join(p for p in parts if p)


def chunk_units(units: Iterable[ParsedUnit]) -> list[Chunk]:
    chunks: list[Chunk] = []
    last_parent_index: int | None = None

    for unit in units:
        body = unit.text.strip()
        if not body:
            continue
        breadcrumb = build_breadcrumb(unit.path)
        prefixed = f"{breadcrumb}\n\n{body}" if breadcrumb else body

        parent_index = None if unit.level == ChunkLevel.section else last_parent_index
        chunk = Chunk(
            text=prefixed,
            body=body,
            breadcrumb=breadcrumb,
            level=unit.level,
            section_number=unit.section_number,
            subsection=unit.subsection,
            clause=unit.clause,
            proviso_no=unit.proviso_no,
            explanation_no=unit.explanation_no,
            rule_number=unit.rule_number,
            subrule=unit.subrule,
            act_name=unit.act_name,
            effective_date=unit.effective_date,
            extra=unit.extra,
            parent_index=parent_index,
        )
        chunks.append(chunk)
        if unit.level == ChunkLevel.section:
            last_parent_index = len(chunks) - 1
    return chunks
