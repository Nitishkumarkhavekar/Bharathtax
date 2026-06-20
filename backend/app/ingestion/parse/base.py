"""Shared legal-structure parsing primitives.

The Act and Rules differ only in their top-level unit ("Section N." vs "Rule N.")
and breadcrumb labels; the *inner* breakdown — sub-sections (1), clauses (a),
provisos, Explanations — is identical, so it lives here once.

Output contract: a parser yields a FLAT, ORDERED stream of ParsedUnit where each
top-level unit (level=section) carries the FULL unit text (parent context),
immediately followed by its child units (level=subsection/para). The chunker
links each child to the most recent section-level parent.
"""
from __future__ import annotations

import re
from collections.abc import Iterator

from app.ingestion.contracts import ParsedUnit
from app.ingestion.parse.cleaning import collapse_ws
from app.core.enums import ChunkLevel

# A top-level unit header at line start: "80C. Title", "9A. Title", "2. Definitions".
# Allow leading amendment brackets ("[80C." comes from India Code's "1[80C.").
TOP_HEADER = re.compile(r"^\[*\s*(?P<num>\d{1,3}[A-Z]{0,3})\.\s+(?P<title>\S.*)$")


def _title_key(s: str) -> str:
    """Normalised title prefix for matching a body header against its TOC entry."""
    return re.sub(r"[^a-z0-9]", "", s.lower())[:12]


def _titles_match(a: str, b: str) -> bool:
    ka, kb = _title_key(a), _title_key(b)
    if not ka or not kb:
        return False
    return ka.startswith(kb[:8]) or kb.startswith(ka[:8])
# "CHAPTER VIA" / "CHAPTER VI-A" / "[CHAPTER VIA" (amendment bracket) all occur
# in this corpus -> normalise the numeral to "VIA".
CHAPTER = re.compile(r"^\[*\s*CHAPTER\s+(?P<rom>[IVXLC]+)(?:-?(?P<suf>[A-Z]+))?\b", re.I)

# Inner-unit openers (line-leading).
SUBSECTION = re.compile(r"^\((?P<n>\d{1,3}[A-Z]?)\)\s+")          # (1) (2) (2A)
PROVISO = re.compile(r"^Provided\s+(further\s+|also\s+)?that\b", re.I)
EXPLANATION = re.compile(r"^Explanation\s*(?P<n>\d+)?\s*[\.\—:-]", re.I)


def iter_chapter_titles(lines: list[str]) -> dict[int, tuple[str, str]]:
    """Map line-index -> (roman, title) for chapter markers (title = next line)."""
    out: dict[int, tuple[str, str]] = {}
    for i, ln in enumerate(lines):
        m = CHAPTER.match(ln.strip())
        if m:
            roman = m.group("rom") + (m.group("suf") or "")
            title = lines[i + 1].strip() if i + 1 < len(lines) else ""
            out[i] = (roman, collapse_ws(title))
    return out


def split_inner_units(body: str) -> list[tuple[ChunkLevel, dict, str]]:
    """Split a section/rule body into ordered (level, fields, text) sub-units on
    sub-section / proviso / Explanation boundaries. A proviso or Explanation is
    therefore NEVER split away from its anchor mid-unit — it becomes its own unit.
    If no structure is found, returns a single para spanning the whole body."""
    lines = body.splitlines()
    units: list[tuple[ChunkLevel, dict, str]] = []
    cur_level = ChunkLevel.para
    cur_fields: dict = {}
    cur_buf: list[str] = []

    def flush() -> None:
        text = "\n".join(cur_buf).strip()
        if text:
            units.append((cur_level, dict(cur_fields), text))

    for ln in lines:
        s = ln.strip()
        m_sub = SUBSECTION.match(s)
        m_prov = PROVISO.match(s)
        m_exp = EXPLANATION.match(s)
        if m_sub or m_prov or m_exp:
            flush()
            cur_buf = [ln]
            if m_sub:
                cur_level, cur_fields = ChunkLevel.subsection, {"subsection": f"({m_sub.group('n')})"}
            elif m_exp:
                n = m_exp.group("n")
                cur_level, cur_fields = ChunkLevel.para, {"explanation_no": n or "1"}
            else:  # proviso
                cur_level, cur_fields = ChunkLevel.para, {"proviso_no": _proviso_ordinal(s)}
        else:
            cur_buf.append(ln)
    flush()
    return units


def _proviso_ordinal(s: str) -> str:
    low = s.lower()
    if "further" in low:
        return "2"
    if "also" in low:
        return "3"
    return "1"


def parse_sections(
    text: str,
    *,
    act_name: str,
    top_label: str,            # "Section" | "Rule"
    number_field: str,         # "section_number" | "rule_number"
    valid_numbers: set[str] | None = None,
    section_titles: dict[str, str] | None = None,
) -> Iterator[ParsedUnit]:
    """Generic Act/Rules parser. `valid_numbers` (from a TOC) disambiguates real
    section starts from incidental "12." occurrences; `section_titles` (num->TOC
    title) confirms a body header by title and dedupes to the first occurrence.
    If both are None, all plausible headers are accepted."""
    lines = text.splitlines()
    chapters = iter_chapter_titles(lines)

    # Determine the chapter in force at each line index.
    chapter_at: list[tuple[str, str] | None] = [None] * len(lines)
    current: tuple[str, str] | None = None
    chap_keys = sorted(chapters)
    ci = 0
    for i in range(len(lines)):
        while ci < len(chap_keys) and chap_keys[ci] <= i:
            current = chapters[chap_keys[ci]]
            ci += 1
        chapter_at[i] = current

    # Locate section header line indices.
    headers: list[tuple[int, str, str]] = []  # (line_idx, number, title)
    seen: set[str] = set()
    for i, ln in enumerate(lines):
        m = TOP_HEADER.match(ln)
        if not m:
            continue
        num = m.group("num")
        if valid_numbers is not None and num not in valid_numbers:
            continue
        title = collapse_ws(m.group("title"))
        if section_titles is not None:
            toc_title = section_titles.get(num)
            if not toc_title or not _titles_match(title, toc_title):
                continue          # number reused in running text, not a real header
            if num in seen:
                continue          # keep only the first real occurrence
            seen.add(num)
        headers.append((i, num, title))

    for h, (start, num, title) in enumerate(headers):
        end = headers[h + 1][0] if h + 1 < len(headers) else len(lines)
        body = "\n".join(lines[start:end]).strip()
        chap = chapter_at[start]
        path: list[tuple[str, str]] = [("Act", act_name)]
        if chap:
            path.append(("Chapter", f"{chap[0]} {chap[1]}".strip()))
        path.append((top_label, num))

        # Parent unit: the whole section (context for the LLM).
        yield ParsedUnit(
            text=body,
            level=ChunkLevel.section,
            path=list(path),
            act_name=act_name,
            **{number_field: num},
            extra={"title": title, "chapter": chap[0] if chap else None},
        )

        # Child units: sub-sections / provisos / Explanations.
        inner = split_inner_units(body)
        if len(inner) <= 1:
            continue  # nothing to sub-divide; the section chunk stands alone
        for level, fields, utext in inner:
            child_path = list(path)
            if fields.get("subsection"):
                child_path.append(("sub-section", fields["subsection"]))
            elif fields.get("proviso_no"):
                child_path.append(("proviso", fields["proviso_no"]))
            elif fields.get("explanation_no"):
                child_path.append(("Explanation", fields["explanation_no"]))
            yield ParsedUnit(
                text=utext,
                level=level,
                path=child_path,
                act_name=act_name,
                **{number_field: num},
                subsection=fields.get("subsection"),
                proviso_no=fields.get("proviso_no"),
                explanation_no=fields.get("explanation_no"),
                extra={"title": title},
            )
