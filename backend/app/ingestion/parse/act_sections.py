"""Parser for Acts harvested as pre-segmented sections (scripts/crawl_acts.py).

The crawler already split the Act into sections via the site's own structure and
wrote them delimited by `@@SECTION <num> | <chapter> | <title>` marker lines, so
there is no layout to reverse-engineer: each block IS one section. We emit one
section-level parent per block, plus paragraph children for long sections (e.g. a
Definitions section) so retrieval can match a precise passage while the LLM still
sees the whole section.
"""
from __future__ import annotations

import re
from collections.abc import Iterator

from app.core.enums import ChunkLevel
from app.ingestion.contracts import ParsedUnit

_SPLIT = re.compile(r"(?m)^@@SECTION ")
_TARGET = 1400  # long sections above this get paragraph children


def _windows(body: str) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    out: list[str] = []
    buf = ""
    for p in paras:
        if buf and len(buf) + len(p) > _TARGET:
            out.append(buf)
            buf = p
        else:
            buf = f"{buf}\n\n{p}".strip()
    if buf:
        out.append(buf)
    return out


def parse(text: str, act_name: str | None = None) -> Iterator[ParsedUnit]:
    parts = _SPLIT.split(text)
    head = parts[0].strip()
    act = (act_name or (head.splitlines()[0] if head else "Act")).strip()[:120]

    for block in parts[1:]:
        lines = block.splitlines()
        if not lines:
            continue
        meta = [m.strip() for m in lines[0].split("|")]
        num = meta[0] if meta else ""
        chapter = meta[1] if len(meta) > 1 else ""
        title = meta[2] if len(meta) > 2 else ""
        body = "\n".join(lines[1:]).strip()
        if not body:
            continue

        path = [("Act", act), ("Section", num)]
        extra = {"title": title, "chapter": chapter}
        header = " — ".join(p for p in (chapter, title) if p)
        section_text = f"{header}\n{body}" if header else body

        yield ParsedUnit(
            text=section_text, level=ChunkLevel.section, path=path,
            act_name=act, section_number=num, extra=extra,
        )
        if len(body) > _TARGET:
            for i, chunk in enumerate(_windows(body), 1):
                yield ParsedUnit(
                    text=chunk, level=ChunkLevel.para,
                    path=path + [("para", str(i))], act_name=act,
                    section_number=num, extra={**extra, "para_no": i},
                )
