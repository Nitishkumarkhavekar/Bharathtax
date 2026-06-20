"""Income Tax Act, 1961 parser (India Code layout).

The PDF opens with an 'ARRANGEMENT OF SECTIONS' (a TOC) and then repeats the
chapter sequence for the body. We use the TOC to learn the set of *real* section
numbers (so an incidental '100.' in running text isn't mistaken for a section),
and parse structure from the body only.
"""
from __future__ import annotations

import re
from collections.abc import Iterator

from app.ingestion.contracts import ParsedUnit
from app.ingestion.parse.base import TOP_HEADER, parse_sections

ACT_NAME = "Income Tax Act, 1961"
_CHAPTER_I = re.compile(r"^\[*\s*CHAPTER\s+I\b", re.I)


def _split_toc_body(text: str) -> tuple[str, str]:
    """Return (toc_text, body_text). Body starts at the SECOND 'CHAPTER I'
    (first is in the arrangement of sections). Falls back to (\"\", full)."""
    lines = text.splitlines()
    hits = [i for i, ln in enumerate(lines) if _CHAPTER_I.match(ln.strip())]
    if len(hits) >= 2:
        cut = hits[1]
        return "\n".join(lines[:cut]), "\n".join(lines[cut:])
    return "", text


def _toc_titles(toc_text: str) -> dict[str, str]:
    """num -> title from the arrangement of sections (TOC)."""
    titles: dict[str, str] = {}
    for ln in toc_text.splitlines():
        m = TOP_HEADER.match(ln)
        if m:
            titles.setdefault(m.group("num"), m.group("title").strip())
    return titles


def parse(text: str) -> Iterator[ParsedUnit]:
    toc, body = _split_toc_body(text)
    titles = _toc_titles(toc)
    yield from parse_sections(
        body,
        act_name=ACT_NAME,
        top_label="Section",
        number_field="section_number",
        valid_numbers=set(titles) or None,
        section_titles=titles or None,
    )
