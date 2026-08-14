"""PDF text extraction with a per-page profiler.

The extractor classifies every page into one of four regimes and picks
the cheapest tool that can produce good text for that regime:

    text        — clean embedded text layer            → keep as-is
    mojibake    — text layer present but mangled       → Gemini vision
                  (bilingual scans with broken font
                  mapping, e.g. registered Kannada
                  sale deeds)
    scan        — no text layer, page is an image      → Tesseract, then
                  Gemini vision if Tesseract's output
                  is empty
    sparse      — very little text and no image        → skip (cover
                  sheets, blank endorsement pages)

The routing decision (`_classify_page`) is cheap — it's PyMuPDF text +
image inspection + a wordlike-token ratio, no LLM call. Explicitly
naming what we're doing per page also gives us a compact document
profile we can log for cost accounting and surface to the composer.
"""
from __future__ import annotations

import concurrent.futures as _futures
import os
import re as _re

import fitz  # PyMuPDF

from app.core.logging import get_logger

log = get_logger(__name__)


# ============================================================================
# Thresholds — tunable, but the defaults are calibrated on the 25-Sale Deed
# corpus (mix of BDA electronic PDFs and BNS scanned+pre-OCR'd Kannada deeds).
# ============================================================================
# A page with fewer than this many chars in its text layer is treated as
# "no text" — i.e. it's an image / scan.
_MIN_CHARS_PER_PAGE = 20
# A page's text layer is trusted as-is when its wordlike-token ratio
# (Latin runs with a vowel / total Latin runs) exceeds this.
_WORDLIKE_TRUST_RATIO = 0.55
# Parallel workers for the vision OCR fallback. Each page = one HTTP
# round-trip to Gemini (~5-10 s); dispatching 6 in parallel turns a
# 50-page scan from minutes into seconds. Kept modest so we don't
# burst the Gemini quota. Overridable so ops can tune per-workload.
_VISION_OCR_WORKERS = int(os.getenv("PDF_VISION_OCR_WORKERS", "6"))


# ---------------------------------------------------------------------------
# Page classifier
# ---------------------------------------------------------------------------
def _wordlike_ratio(text: str) -> float:
    tokens = _re.findall(r"[A-Za-z]{2,15}", text)
    if not tokens:
        return 0.0
    wordy = sum(1 for t in tokens if _re.search(r"[aeiouAEIOU]", t))
    return wordy / len(tokens)


def _has_non_latin_script(text: str, scan_prefix: int = 2000) -> bool:
    for c in text[:scan_prefix]:
        cp = ord(c)
        if (0x0900 <= cp <= 0x097F) or (0x0C80 <= cp <= 0x0CFF) \
           or (0x0B80 <= cp <= 0x0BFF) or (0x0C00 <= cp <= 0x0C7F):
            return True
    return False


def _looks_mojibake(text: str) -> bool:
    """Bilingual Indian sale deeds regularly have their text layer built
    by pre-OCR software that maps Kannada / Devanagari / Tamil glyphs
    into garbage Latin (wrong font mapping). The result is still 'text'
    for PyMuPDF — long, but full of noise like 'BwBs Bosos Beodmv'. This
    heuristic flags those pages so we re-run them through Gemini vision.

    Deliberately conservative — a normal English notice with tables and
    stamped seals should NOT trip this.
    """
    if not text or len(text) < 200:
        return False
    ratio = _wordlike_ratio(text)
    if ratio == 0.0:
        # No Latin at all. If we can see real Devanagari / Kannada /
        # Tamil / Telugu codepoints, the layer is fine as-is.
        return not _has_non_latin_script(text)
    if ratio < _WORDLIKE_TRUST_RATIO:
        return True
    # BDA-style mojibake: the text layer LOOKS Latin (survives word-ratio)
    # but is actually broken font-mapped Kannada masquerading as English —
    # tokens like 'BOwWoNn', 'MEMADS', 'BNACTH' are typical. Real English
    # words almost never have 3+ uppercase letters intermixed with
    # lowercase (proper ALL-CAPS or Title-case are fine). If enough tokens
    # in the sample fit that shape, flag the page for vision OCR.
    sample = text[:8000]
    tokens = _re.findall(r"[A-Za-z][A-Za-z0-9]{2,}", sample)
    if len(tokens) < 30:
        return False
    mixed_case_noise = 0
    for t in tokens:
        if t == t.upper() or t == t.lower():
            continue  # proper ALL-CAPS / all-lowercase — fine
        # Title-case (first letter cap, rest lower) is fine
        if t[0].isupper() and t[1:].islower():
            continue
        # Everything else: internal camel-humps like 'BOwWoNn', 'MEMADS'
        upper_count = sum(1 for c in t if c.isupper())
        if upper_count >= 3:
            mixed_case_noise += 1
    # Calibrated on 25-Sale Deed: BDA electronic PDFs with font-mapped
    # Kannada come in at ~8% mixed-case noise; a clean OCR'd English
    # extract (BNS-1-00523_ocred) is ~0.6%. 3% is a safe midpoint.
    if mixed_case_noise / len(tokens) > 0.03:
        return True
    return False


PageProfile = dict  # {"regime": str, "chars": int, "images": int, "word_ratio": float}


def _classify_page(page: "fitz.Page") -> tuple[str, PageProfile]:
    """Return (page_regime, profile_dict) for a single PyMuPDF page.
    The profile also carries the page's raw text if we produced one —
    saves the extract loop a second call to page.get_text()."""
    try:
        text = page.get_text() or ""
    except Exception as e:  # noqa: BLE001
        log.warning("page classifier get_text() failed: %s", str(e)[:120])
        text = ""
    try:
        image_count = len(page.get_images(full=False) or [])
    except Exception:  # noqa: BLE001
        image_count = 0

    chars = len(text.strip())
    ratio = _wordlike_ratio(text) if chars >= 200 else 0.0

    if chars < _MIN_CHARS_PER_PAGE and image_count > 0:
        regime = "scan"
    elif chars < _MIN_CHARS_PER_PAGE:
        regime = "sparse"
    elif _looks_mojibake(text):
        regime = "mojibake"
    else:
        regime = "text"

    return regime, {
        "regime": regime,
        "chars": chars,
        "images": image_count,
        "word_ratio": round(ratio, 3),
        "_text": text,  # cached for extract loop; stripped from public logs
    }


# ---------------------------------------------------------------------------
# OCR primitives
# ---------------------------------------------------------------------------
def _ocr_enabled() -> bool:
    """OCR is opt-out per-run: bulk CPU staging sets ITD_SKIP_OCR=1 so scanned
    pages are left empty (fast) and OCR'd deliberately in a later targeted/GPU
    pass instead of stalling the whole run tens of seconds per scanned doc."""
    return os.getenv("ITD_SKIP_OCR", "").strip() not in ("1", "true", "yes")


def _ocr_page(page: "fitz.Page") -> str:
    try:
        import pytesseract
        from PIL import Image
    except Exception as e:  # pragma: no cover - optional path
        log.warning("OCR deps unavailable, skipping OCR: %s", e)
        return ""
    try:
        pix = page.get_pixmap(dpi=200)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        return pytesseract.image_to_string(img, lang="eng")
    except Exception as e:  # noqa: BLE001
        log.warning("OCR failed on a page, skipping it: %s", str(e)[:120])
        return ""


def _rasterise_png(page: "fitz.Page") -> bytes | None:
    """Render a page to PNG bytes so the vision OCR path can process it
    without holding on to the PyMuPDF Page object (unsafe across threads)."""
    try:
        pix = page.get_pixmap(dpi=200)
        return pix.tobytes("png")
    except Exception as e:  # noqa: BLE001
        log.warning("page rasterise failed: %s", str(e)[:120])
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def extract(raw: bytes) -> str:
    """Extract text from a PDF, routing each page by its profile.

    The scaffolding here is deliberately linear:
      1. Classify every page (cheap — PyMuPDF only)
      2. For 'text' pages, keep the embedded layer verbatim
      3. For 'scan' pages, try Tesseract; failures fall through to vision
      4. For 'mojibake' pages, go straight to vision (Tesseract would just
         produce more garbage on a page whose real script isn't Latin)
      5. For 'sparse' pages, skip (nothing to recover)
      6. Vision calls run in a parallel pool so a 50-page scan is minutes
         → seconds instead of minutes-times-page-count

    We log a per-doc profile at the end so cost/quality trends are visible
    without needing a persistent DB column.
    """
    doc = fitz.open(stream=raw, filetype="pdf")
    n = doc.page_count
    pages: list[str] = ["" for _ in range(n)]

    # ---- Pass 1: classify every page ----
    profiles: list[PageProfile] = []
    for i in range(n):
        page = doc.load_page(i)
        regime, prof = _classify_page(page)
        # Trusted text-layer pages: keep as-is immediately.
        if regime == "text":
            pages[i] = prof["_text"]
        profiles.append(prof)

    # If OCR is turned off (bulk staging), stop here — text-layer only.
    if not _ocr_enabled():
        _log_profile(profiles, tesseract_ok=0, vision_ok=0, ocr_skipped=True)
        return "\n".join(pages)

    # ---- Pass 2: Tesseract for scan pages (fast when it works) ----
    tesseract_ok = 0
    vision_queue: list[tuple[int, bytes]] = []
    for i, prof in enumerate(profiles):
        if prof["regime"] == "scan":
            ocr_text = _ocr_page(doc.load_page(i))
            # Trust Tesseract only if its output looks like real language.
            # Kannada / Devanagari scans run through English-only Tesseract
            # produce plausibly-shaped garbage ('MEMADS Oe Sows', 'BOwWoNn')
            # that survived old versions of this branch and then poisoned
            # the composer with fabricated-looking names & addresses. Route
            # those to vision instead, which reads the script natively.
            if ocr_text.strip() and not _looks_mojibake(ocr_text):
                pages[i] = ocr_text
                tesseract_ok += 1
                continue
            # Tesseract couldn't read the page — queue for vision.
            png = _rasterise_png(doc.load_page(i))
            if png:
                vision_queue.append((i, png))
        elif prof["regime"] == "mojibake":
            # Skip Tesseract entirely — mojibake means the source script
            # is non-Latin and Tesseract-eng will just fabricate more noise.
            png = _rasterise_png(doc.load_page(i))
            if png:
                vision_queue.append((i, png))
        # 'text' pages already populated in Pass 1.
        # 'sparse' pages stay empty (cover sheets, blank endorsements).

    # ---- Pass 3: Gemini vision in parallel ----
    vision_ok = 0
    if vision_queue:
        try:
            from app.ingestion.extract.vision import extract_image
        except Exception as e:  # noqa: BLE001
            log.warning("vision module unavailable: %s", e)
            extract_image = None  # type: ignore[assignment]
        if extract_image is not None:
            workers = max(1, min(_VISION_OCR_WORKERS, len(vision_queue)))
            with _futures.ThreadPoolExecutor(max_workers=workers) as pool:
                fut_map = {
                    pool.submit(extract_image, png, "image/png"): i
                    for (i, png) in vision_queue
                }
                for fut in _futures.as_completed(fut_map):
                    idx = fut_map[fut]
                    try:
                        txt = fut.result() or ""
                    except Exception as e:  # noqa: BLE001
                        log.warning("vision fallback failed on page %d: %s",
                                    idx, str(e)[:120])
                        txt = ""
                    if txt.strip():
                        pages[idx] = txt
                        vision_ok += 1

    _log_profile(profiles, tesseract_ok=tesseract_ok, vision_ok=vision_ok)
    return "\n".join(pages)


def _log_profile(profiles: list[PageProfile], *, tesseract_ok: int,
                 vision_ok: int, ocr_skipped: bool = False) -> None:
    """Emit a one-line summary of what each PDF looks like and how we
    treated it — useful for ops dashboards and post-hoc cost accounting.
    """
    counts: dict[str, int] = {"text": 0, "mojibake": 0, "scan": 0, "sparse": 0}
    for p in profiles:
        counts[p["regime"]] = counts.get(p["regime"], 0) + 1
    total = sum(counts.values())
    tail = " ocr=SKIPPED" if ocr_skipped else ""
    log.info(
        "PDF profile: %d pages · text=%d mojibake=%d scan=%d sparse=%d · "
        "tesseract=%d vision=%d%s",
        total, counts["text"], counts["mojibake"], counts["scan"],
        counts["sparse"], tesseract_ok, vision_ok, tail,
    )


def summarise_profile(raw: bytes) -> dict:
    """Cheap doc-level profile without doing any OCR — used by the attach
    layer to hint the composer about what it's working with (e.g.
    'mostly-scanned Kannada deed, some fields may not be readable')."""
    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception:  # noqa: BLE001
        return {"pages": 0, "regimes": {}}
    counts: dict[str, int] = {"text": 0, "mojibake": 0, "scan": 0, "sparse": 0}
    for i in range(doc.page_count):
        page = doc.load_page(i)
        regime, _ = _classify_page(page)
        counts[regime] = counts.get(regime, 0) + 1
    return {"pages": doc.page_count, "regimes": counts}
