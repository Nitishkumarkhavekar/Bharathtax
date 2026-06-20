"""Best-effort normalisation of government PDF text.

India Code / dept PDFs carry artefacts that hurt both parsing and search:
  * `1[ ... ]` / `2[ ... ]` footnote-amendment markers (superscript digit + bracket)
  * a font-mapping quirk where em-dashes and curly quotes extract as the
    replacement char `�`
  * running page headers ("THE INCOME-TAX ACT, 1961") and bare page numbers

We retain the RAW text in the DB regardless, so this stays intentionally simple
and improvable without re-fetching. Nothing here invents content.
"""
from __future__ import annotations

import re

_FOOTNOTE_OPEN = re.compile(r"(?<!\w)\d{1,3}\[")        # 1[  2[  preceding an amendment
_FOOTNOTE_DIGIT = re.compile(r"(?<=[a-z\)\]])\d{1,2}(?=\[)")  # stray superscript before [
_PAGE_NUMBER_LINE = re.compile(r"^\s*\d{1,4}\s*$")
_MULTISPACE = re.compile(r"[ \t]{2,}")
_MULTINEWLINE = re.compile(r"\n{3,}")


def normalise(text: str, *, drop_headers: tuple[str, ...] = ()) -> str:
    # 1) the � glyph stands in for em-dash or curly quotes; '—' is the
    #    overwhelmingly common case in this corpus (Explanation.—, word—word).
    text = text.replace("�", "—")

    # 2) strip footnote-amendment scaffolding but KEEP the amended text inside.
    text = _FOOTNOTE_OPEN.sub("[", text)
    text = _FOOTNOTE_DIGIT.sub("", text)

    cleaned_lines: list[str] = []
    for raw in text.splitlines():
        line = raw.rstrip()
        if _PAGE_NUMBER_LINE.match(line):
            continue
        stripped = line.strip()
        if stripped and drop_headers and stripped.upper() in drop_headers:
            continue
        cleaned_lines.append(line)

    out = "\n".join(cleaned_lines)
    out = _MULTISPACE.sub(" ", out)
    out = _MULTINEWLINE.sub("\n\n", out)
    return out.strip()


def collapse_ws(text: str) -> str:
    """Single-line whitespace collapse (for titles/breadcrumbs)."""
    return re.sub(r"\s+", " ", text).strip()
