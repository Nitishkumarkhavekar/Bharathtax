"""PDF text extraction. Prefer the embedded text layer (PyMuPDF); fall back to
OCR (Tesseract) ONLY for scanned pages with no text — never by default."""
from __future__ import annotations

import fitz  # PyMuPDF

from app.core.logging import get_logger

log = get_logger(__name__)

# If a page yields fewer than this many chars, treat it as image-only -> OCR it.
_MIN_CHARS_PER_PAGE = 20


def _ocr_page(page: "fitz.Page") -> str:
    try:
        import pytesseract
        from PIL import Image
    except Exception as e:  # pragma: no cover - optional path
        log.warning("OCR deps unavailable, skipping OCR: %s", e)
        return ""
    pix = page.get_pixmap(dpi=300)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return pytesseract.image_to_string(img, lang="eng")


def extract(raw: bytes) -> str:
    doc = fitz.open(stream=raw, filetype="pdf")
    pages: list[str] = []
    ocr_pages = 0
    for page in doc:
        text = page.get_text()
        if len(text.strip()) < _MIN_CHARS_PER_PAGE:
            ocr_text = _ocr_page(page)
            if ocr_text.strip():
                ocr_pages += 1
                text = ocr_text
        pages.append(text)
    if ocr_pages:
        log.info("OCR fallback used on %d/%d pages", ocr_pages, doc.page_count)
    return "\n".join(pages)
