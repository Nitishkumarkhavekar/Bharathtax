"""CBDT Circulars / Notifications parser.

These are short prose documents, not hierarchical law. We emit one section-level
unit (the whole document = parent context) plus paragraph-level children split on
numbered paragraphs ('1.', '2.') or blank lines, so retrieval can match a precise
paragraph while the LLM still sees the whole circular.
"""
from __future__ import annotations

import re
from collections.abc import Iterator

from app.ingestion.contracts import ParsedUnit
from app.ingestion.parse.cleaning import collapse_ws
from app.core.enums import ChunkLevel

_NUM_PARA = re.compile(r"^\s*(\d{1,2})\.\s+\S")
_TARGET_CHARS = 900  # soft cap so a long unnumbered circular still sub-divides


def _title(text: str, fallback: str) -> str:
    for ln in text.splitlines():
        s = ln.strip()
        if s:
            return collapse_ws(s)[:200]
    return fallback


def parse(text: str, *, doc_title: str = "Circular", doc_type_label: str = "Circular") -> Iterator[ParsedUnit]:
    text = text.strip()
    title = _title(text, doc_title)
    base_path = [(doc_type_label, title)]

    # Parent: whole document.
    yield ParsedUnit(
        text=text,
        level=ChunkLevel.section,
        path=list(base_path),
        act_name=title,
        extra={"title": title, "doc_type": doc_type_label},
    )

    # Children: paragraphs.
    paras: list[str] = []
    buf: list[str] = []

    def flush() -> None:
        chunk = "\n".join(buf).strip()
        if chunk:
            paras.append(chunk)

    for ln in text.splitlines():
        if _NUM_PARA.match(ln) or (len("\n".join(buf)) > _TARGET_CHARS and not ln.strip()):
            flush()
            buf = [ln]
        else:
            buf.append(ln)
    flush()

    if len(paras) <= 1:
        return
    for idx, para in enumerate(paras, start=1):
        m = _NUM_PARA.match(para)
        para_no = m.group(1) if m else str(idx)
        yield ParsedUnit(
            text=para,
            level=ChunkLevel.para,
            path=base_path + [("para", para_no)],
            act_name=title,
            extra={"title": title, "para_no": para_no},
        )
