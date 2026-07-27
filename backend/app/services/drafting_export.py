"""Render a drafted notice/order to a clean, editable .docx (Times New Roman 12,
A4, 1.5 spacing) — ready to place on the office letterhead / paste into ITBA."""
from __future__ import annotations

import io
import re

from docx import Document
from docx.enum.text import WD_LINE_SPACING
from docx.shared import Cm, Pt

_BODY_FONT = "Times New Roman"


def _add_runs(p, text: str) -> None:
    """Render **bold** segments; everything else plain."""
    for seg in re.split(r"(\*\*.+?\*\*)", text):
        if not seg:
            continue
        if seg.startswith("**") and seg.endswith("**") and len(seg) > 4:
            p.add_run(seg[2:-2]).bold = True
        else:
            p.add_run(seg)


def to_docx(title: str, content: str) -> bytes:
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = _BODY_FONT
    style.font.size = Pt(12)
    style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    style.paragraph_format.line_spacing = 1.5
    style.paragraph_format.space_after = Pt(6)
    for section in doc.sections:
        section.top_margin = section.bottom_margin = Cm(2.5)
        section.left_margin = section.right_margin = Cm(2.5)

    for raw in (content or "").splitlines():
        line = raw.rstrip()
        # blank line -> a spacer paragraph
        if not line.strip():
            doc.add_paragraph()
            continue
        p = doc.add_paragraph()
        # A markdown heading (#...) or a fully-bold short line -> bold, no marker.
        m = re.match(r"^\s{0,3}#{1,6}\s+(.*)$", line)
        if m:
            p.add_run(m.group(1).strip()).bold = True
        else:
            _add_runs(p, line)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
