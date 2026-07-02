"""Extraction dispatch by content type. Always returns raw extracted text; the
parse stage applies legal-text normalisation."""
from __future__ import annotations

from app.ingestion.extract import docx, html, pdf


def extract_text(raw: bytes, content_type: str, *, filename: str = "") -> str:
    ct = (content_type or "").lower()
    name = filename.lower()
    if "pdf" in ct or name.endswith(".pdf"):
        return pdf.extract(raw)
    if "wordprocessingml.document" in ct or name.endswith(".docx"):
        return docx.extract(raw)
    if "html" in ct or name.endswith((".html", ".htm")):
        return html.extract(raw)
    # plain text / unknown: best-effort decode
    return raw.decode("utf-8", errors="replace")
