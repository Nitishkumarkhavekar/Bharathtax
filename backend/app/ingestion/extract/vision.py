"""Gemini-vision OCR — extracts text from image bytes (JPEG / PNG / WebP /
HEIC) and from image-only or handwritten PDF pages.

We use Gemini directly rather than Tesseract because:
  * Tesseract needs the system binary + language packs installed.
  * Gemini reads handwriting, tables, low-quality scans and Devanagari /
    Tamil / etc. out of the box — no per-language configuration.
  * The API key is already configured for the chat pipeline; adding
    another provider would double the ops surface.

The prompt is deliberately narrow: "return only the text you can read,
verbatim". We do NOT ask Gemini to summarise or interpret — the caller
(document indexer, then the tax agent) will do that later using the
extracted text.
"""
from __future__ import annotations

import base64
import logging
import os
import time

import httpx

# Shared Gemini transport — abstracts AI Studio vs Vertex. When
# GEMINI_BACKEND=vertex, OCR piggybacks on the same Vertex project as
# the chat pipeline (one bill, one set of quotas). On AI Studio we
# keep the dedicated OCR-key isolation the operator may have set up.
from app.services import gemini_transport as _tx

log = logging.getLogger(__name__)

# Dedicated OCR API key — lets ops isolate vision traffic from the chat
# quota (or use a different Google project entirely for OCR billing).
# Falls back to the shared GEMINI_API_KEY when unset. Only used when the
# transport is AI Studio; on Vertex the OAuth token is minted by _tx.
_KEY = os.getenv("GEMINI_OCR_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
# Vision-capable, fast, cheap. Overridable so ops can pin a different tier.
_MODEL = os.getenv(
    "OCR_MODEL",
    os.getenv("GEMINI_OCR_MODEL", "gemini-flash-latest"),
)
_TIMEOUT_S = float(os.getenv("OCR_TIMEOUT_S", "45"))
# 20 MB is Gemini's per-inline-part cap. Anything larger has to be
# uploaded via the Files API — for tax documents this is almost never
# hit (a full A4 PDF page renders to ~1.5 MB even at 200 DPI).
_MAX_INLINE_BYTES = 18 * 1024 * 1024


_OCR_PROMPT = (
    "You are an OCR engine. Read the image and return ONLY the text that "
    "appears in it, VERBATIM, preserving line breaks and layout.\n"
    "\n"
    "RULES — follow every one:\n"
    "1. COMPLETENESS: transcribe EVERY visible piece of text on the page — "
    "headers, footers, page numbers, stamps, seals, signatures, sidebar "
    "notes, watermarks, table cells (row by row, cell by cell), form "
    "labels AND their values, footnotes, addresses, phone numbers, "
    "reference numbers, dates, amounts. Do NOT skip anything, even if "
    "it looks decorative or repetitive.\n"
    "2. LANGUAGE: transcribe text in ITS ORIGINAL SCRIPT and language — "
    "English in Latin script, Hindi/Marathi/Sanskrit in Devanagari, "
    "Kannada in Kannada script, Tamil in Tamil script, Telugu in Telugu, "
    "Bengali in Bengali, Urdu in Arabic script, Punjabi in Gurmukhi. "
    "Do NOT translate to English. Do NOT transliterate. If a document "
    "has both Kannada AND English (bilingual court forms, sale deeds, "
    "government notices), transcribe BOTH — the Kannada block first, "
    "then the English block, with a blank line between them.\n"
    "3. FORMS: for structured forms (PAN card, Aadhaar, TDS certificate, "
    "sale deed, notice, invoice, bank statement), use `Label: Value` "
    "syntax for every field — 'Name: JOHN DOE', 'PAN: ABCDE1234F', "
    "'Consideration: Rs 28,75,000/-', 'Sub-Registrar: BENGALURU URBAN'. "
    "Emit every checkbox / radio state ('☑ Yes', '☐ No').\n"
    "4. TABLES: preserve as pipe-separated rows. First row is the header, "
    "then a separator (`| --- | --- |`), then each data row.\n"
    "5. HANDWRITING: transcribe as best you can. If a word is unclear, "
    "put your best guess followed by `[?]`.\n"
    "6. NUMBERS: keep every digit, comma, decimal, currency mark exactly "
    "as printed. `Rs 28,75,000/-` stays `Rs 28,75,000/-`. Aadhaar and PAN "
    "numbers stay in their original format.\n"
    "7. STRUCTURE: preserve line breaks and paragraph gaps. Use `---` on "
    "its own line to mark a horizontal rule / section break.\n"
    "8. NO COMMENTARY: do NOT add 'Sure, here is', do NOT summarise, do "
    "NOT interpret. Output starts with the first character of the text.\n"
    "9. If the image genuinely contains no readable text at all "
    "(pure photograph of a landscape, blank page, chart with no labels), "
    "respond with exactly the token: [NO_TEXT]"
)


def _looks_supported(content_type: str) -> bool:
    ct = (content_type or "").lower()
    return ct.startswith("image/") and not ct.endswith("svg+xml")


def _mime_for(content_type: str) -> str:
    ct = (content_type or "").lower().strip()
    # Gemini accepts image/png, image/jpeg, image/webp, image/heic, image/heif
    if ct in ("image/jpg",):
        return "image/jpeg"
    if not ct.startswith("image/"):
        return "image/png"
    return ct


def _endpoint_url(model: str) -> str:
    """Full generateContent URL for the currently-configured backend.
    Vertex -> aiplatform, AI Studio -> generativelanguage."""
    if _tx.is_vertex():
        return _tx.url(model, "generateContent")
    return f"{_BASE}/{model}:generateContent"


def _auth_headers() -> dict:
    """Auth + JSON headers. On Vertex we mint an OAuth token via _tx;
    on AI Studio we use the OCR-scoped API key (or the shared one)."""
    if _tx.is_vertex():
        return _tx.headers()
    return {"x-goog-api-key": _KEY, "Content-Type": "application/json"}


def _credentials_available() -> bool:
    return _tx.is_vertex() or bool(_KEY)


def extract_image(raw: bytes, content_type: str = "image/png") -> str:
    """OCR a single image file. Returns the extracted text, or "" when the
    key isn't configured / the model is unavailable / no text was found."""
    if not _credentials_available():
        log.info("vision OCR skipped: no credentials (neither Vertex SA nor GEMINI_API_KEY)")
        return ""
    if not raw:
        return ""
    if len(raw) > _MAX_INLINE_BYTES:
        log.warning("vision OCR skipped: image %d bytes exceeds inline cap",
                    len(raw))
        return ""
    if not _looks_supported(content_type):
        # Still try — Gemini often accepts by header sniffing — but log.
        log.debug("vision OCR: unusual content_type %r, attempting anyway",
                  content_type)

    b64 = base64.b64encode(raw).decode("ascii")
    body = {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": _OCR_PROMPT},
                {"inlineData": {"mimeType": _mime_for(content_type),
                                "data": b64}},
            ],
        }],
        "generationConfig": {
            "temperature": 0.0,
            # Raised from 4 096 so a dense A4 page (bilingual sale deed,
            # multi-column notice, table-heavy TDS certificate) transcribes
            # completely instead of getting cut mid-sentence. A single page
            # is typically 2 000 – 6 000 tokens; 16 384 leaves headroom.
            "maxOutputTokens": 16384,
            # Vision needs SOME thinking budget to actually read the
            # image — 0 tokens leaves it too eager and skips fine text.
            # A larger budget also helps with mixed-script pages where
            # the model has to identify Kannada vs English blocks.
            "thinkingConfig": {"thinkingBudget": 1024},
        },
    }
    # Vision endpoints get overloaded intermittently — retry the transient
    # 429/503/400-rate-limit cases with modest backoff before giving up.
    # We ALTERNATE primary → fallback → primary → fallback so a sustained
    # outage on the primary model doesn't kill OCR (previous version only
    # tried the fallback on attempt 3, and if primary was flapping 503 we
    # exhausted attempts 0/1 on the same broken endpoint). Default
    # fallback is 'flash-lite-latest' — reliably accessible on both free
    # and paid tiers, cheaper, and OCR is a low-reasoning task so the
    # smaller model is a fine trade.
    _fallback_model = os.getenv("OCR_FALLBACK_MODEL", "gemini-flash-lite-latest")
    _model_chain = [_MODEL]
    if _fallback_model and _fallback_model != _MODEL:
        _model_chain.append(_fallback_model)
    r = None
    for attempt, wait in enumerate((0.0, 1.5, 4.0, 9.0)):
        if wait:
            log.info("vision OCR retry %d after %.1fs", attempt, wait)
            time.sleep(wait)
        model_to_try = _model_chain[attempt % len(_model_chain)]
        try:
            with httpx.Client(timeout=httpx.Timeout(_TIMEOUT_S)) as c:
                r = c.post(
                    _endpoint_url(model_to_try),
                    headers=_auth_headers(),
                    json=body,
                )
        except Exception as e:  # noqa: BLE001
            log.warning("vision OCR request failed (attempt %d): %s", attempt, e)
            continue
        if r.status_code == 200:
            break
        body_txt = ""
        try:
            body_txt = r.text.lower()
        except Exception:  # noqa: BLE001
            pass
        retryable = (
            r.status_code in (429, 503)
            or (r.status_code == 400 and any(k in body_txt for k in
                ("invalid argument", "rate", "quota", "resource_exhausted")))
        )
        if not retryable:
            break
        if attempt == 3:  # last attempt exhausted — nothing to retry into
            break
        log.warning("vision OCR HTTP %s on %s — will retry (attempt %d/4)",
                    r.status_code, model_to_try, attempt + 1)
    if not r or r.status_code != 200:
        code = r.status_code if r else "n/a"
        log.warning("vision OCR gave up (HTTP %s)", code)
        return ""
    try:
        data = r.json()
    except Exception:  # noqa: BLE001
        return ""
    cand = (data.get("candidates") or [{}])[0]
    parts = (cand.get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts).strip()
    if text == "[NO_TEXT]" or not text:
        return ""
    return text


def extract_pdf_page_via_vision(page: "object") -> str:  # type: ignore[valid-type]
    """OCR a single PyMuPDF page by rasterising it and passing the bitmap
    to Gemini. Used as the fallback path in pdf.extract for pages that
    have no embedded text layer AND for handwritten scans where the
    Tesseract path returns garbage."""
    try:
        import fitz  # noqa: F401
        pix = page.get_pixmap(dpi=200)
        png_bytes = pix.tobytes("png")
    except Exception as e:  # noqa: BLE001
        log.warning("pdf page rasterise failed: %s", e)
        return ""
    return extract_image(png_bytes, "image/png")
