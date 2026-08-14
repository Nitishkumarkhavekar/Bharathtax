"""Extraction dispatch by content type. Always returns raw extracted text; the
parse stage applies legal-text normalisation."""
from __future__ import annotations

from app.ingestion.extract import docx, html, pdf, vision


_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".heic", ".heif", ".bmp", ".gif", ".tiff", ".tif")


def extract_text(raw: bytes, content_type: str, *, filename: str = "") -> str:
    ct = (content_type or "").lower()
    name = filename.lower()
    if "pdf" in ct or name.endswith(".pdf"):
        return pdf.extract(raw)
    if "wordprocessingml.document" in ct or name.endswith(".docx"):
        return docx.extract(raw)
    if "html" in ct or name.endswith((".html", ".htm")):
        return html.extract(raw)
    # Images — route to Gemini vision. Handles typed printouts, PAN card
    # photos, TDS certificates, scanned notices and handwriting; returns
    # "" only when the model genuinely finds no text (e.g. a solid-colour
    # placeholder), in which case the doc chunker will surface a friendly
    # "text extract not ready" note downstream.
    if ct.startswith("image/") or name.endswith(_IMAGE_EXTS):
        return vision.extract_image(raw, content_type or "image/png")
    # plain text / unknown: best-effort decode
    return raw.decode("utf-8", errors="replace")
