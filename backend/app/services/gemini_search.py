"""Gemini + Google Search grounding — the chatbot's WEB FALLBACK.

Used ONLY when the corpus-grounded model has no answer, so recent circulars and
procedural/portal questions can still be answered — clearly labelled as web-sourced
and cited, never presented as the statute. Prefers official Government sources.
"""
from __future__ import annotations

import os
import re
import time
from datetime import date

import httpx

from app.core.logging import get_logger

log = get_logger(__name__)

_KEY = os.getenv("GEMINI_API_KEY", "").strip()
# Web-search fallback for the Ask Bot. Grounding requires Flash or Pro.
# We use Flash for cost. Envvar `GEMINI_SEARCH_MODEL` lets an operator swap in
# 2.5 Pro if answer quality on time-sensitive queries needs the upgrade.
_MODEL = os.getenv("GEMINI_SEARCH_MODEL", "gemini-2.5-flash")
_ENABLED = os.getenv("WEB_SEARCH_ENABLED", "1").lower() not in ("0", "false", "no", "")
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
# Output-token cap. Officer replies are typically 200-400 words (~600 tokens),
# so 1200 gives ample headroom without paying for a 2600-token ceiling every
# time. Bring it up via env if answers are getting cut off.
_MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_SEARCH_MAX_OUTPUT", "1200"))

# Telemetry from the most recent web_answer() call, mirroring OpenAICompatLLM's
# last_* attributes so the chat route can bill the Gemini token spend.
last_usage: dict | None = None
last_model: str | None = None
last_latency_ms: int | None = None

# Trimmed system prompt. Every non-essential word here costs prompt tokens on
# every single web-search call, so we keep it tight. Concrete instructions
# (source preference, output style, no inline citation markers) survive.
_SYS = (
    "Indian income-tax assistant. Answer using current web sources — prefer "
    "incometax.gov.in / incometaxindia.gov.in / CBDT circulars. Be precise on "
    "section numbers, limits, dates, and AY. If unsure, say so. Never invent a "
    "citation.\n"
    "COMPOSE A PROPER ANSWER — not a raw data dump:\n"
    "1) Open with ONE short framing sentence that directly answers the question.\n"
    "2) Then the substance, grouped logically, with **bold** key terms. For case "
    "law write each as a flowing line: **Case name** (citation, court) \u2014 the "
    "principle in one sentence. Do NOT use 'Court:' / 'Citation:' / 'Key Principle:' "
    "as separate labelled bullets.\n"
    "3) Close with a short **Conclusion** (1\u20133 sentences) synthesising the key "
    "takeaway.\n"
    "If a citation is unavailable, give the year or omit it \u2014 NEVER write "
    "meta-comments like 'not provided in snippets' or 'based on the sources'.\n"
    "STYLE: Clean prose with short bold sub-headings and '- ' bullets where they "
    "help. NO inline [1] / [1.1] markers \u2014 sources render separately. Finish "
    "every sentence."
)


def available() -> bool:
    return bool(_KEY) and _ENABLED


def _domain_of(title: str) -> str:
    return (title or "").replace("https://", "").replace("http://", "").split("/")[0].strip()


def _insert_inline_cites(text: str, supports: list, chunks: list) -> str:
    """Insert {{cite:domain}} markers at each grounded segment end using Gemini's
    groundingSupports (segment byte-offsets -> source chunk indices). The UI turns
    each marker into a small favicon chip next to that point."""
    if not text or not supports or not chunks:
        return (text or "").strip()
    by_end: dict = {}
    for sup in supports:
        seg = sup.get("segment") or {}
        end = seg.get("endIndex")
        if end is None:
            continue
        doms: list = []
        for ci in (sup.get("groundingChunkIndices") or []):
            if isinstance(ci, int) and 0 <= ci < len(chunks):
                dm = _domain_of((chunks[ci].get("web") or {}).get("title") or "")
                if dm and dm not in doms:
                    doms.append(dm)
        if doms:
            slot = by_end.setdefault(int(end), [])
            for dm in doms:
                if dm not in slot:
                    slot.append(dm)
    if not by_end:
        return text.strip()
    b = text.encode("utf-8")
    for end in sorted(by_end, reverse=True):
        marker = "".join("{{cite:%s}}" % dm for dm in by_end[end][:2])
        e = max(0, min(int(end), len(b)))
        b = b[:e] + marker.encode("utf-8") + b[e:]
    return b.decode("utf-8", errors="ignore").strip()


def web_answer(question: str) -> tuple[str, list[dict]]:
    """Return (answer_text, [{'title','url'}, ...]); ('', []) on failure/disabled."""
    global last_usage, last_model, last_latency_ms
    last_usage, last_model, last_latency_ms = None, _MODEL, None
    if not available():
        return "", []
    _t0 = time.time()
    dated_sys = (
        _SYS + f"\nToday's date is {date.today().strftime('%d %B %Y')}. Interpret 'latest', "
        "'recent', 'current' and 'this year' relative to THIS date; give the most recent "
        "applicable circular/notification and the correct current assessment year."
    )
    body = {
        "systemInstruction": {"parts": [{"text": dated_sys}]},
        "contents": [{"role": "user", "parts": [{"text": question}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": _MAX_OUTPUT_TOKENS, "thinkingConfig": {"thinkingBudget": 0}},
    }
    last_err = None
    for attempt in range(3):
        try:
            with httpx.Client(timeout=httpx.Timeout(75.0)) as c:
                r = c.post(f"{_BASE}/{_MODEL}:generateContent",
                           headers={"x-goog-api-key": _KEY, "Content-Type": "application/json"},
                           json=body)
            if r.status_code == 429 or r.status_code >= 500:
                last_err = f"HTTP {r.status_code}"
                time.sleep(min(1.5 * (2 ** attempt), 8.0))
                continue
            if r.status_code != 200:
                log.warning("web search HTTP %s: %s", r.status_code, r.text[:200])
                return "", []
            d = r.json()
            cand = (d.get("candidates") or [{}])[0]
            parts = (cand.get("content") or {}).get("parts") or []
            raw_text = "".join(p.get("text", "") for p in parts)
            gm = cand.get("groundingMetadata") or {}
            chunks = gm.get("groundingChunks") or []
            sources: list[dict] = []
            seen = set()
            for ch in chunks:
                web = ch.get("web") or {}
                uri = web.get("uri")
                title = web.get("title") or uri or ""
                if uri and uri not in seen:
                    seen.add(uri)
                    sources.append({"title": title, "url": uri})
            # Insert inline {{cite:domain}} chips at each grounded segment BEFORE
            # stripping bracket clutter (so byte offsets stay valid).
            text = _insert_inline_cites(raw_text, gm.get("groundingSupports") or [], chunks)
            text = re.sub(r"\s*\[[\d.,\s]+\]", "", text)
            text = re.sub(r"\s*\[[\d.,\s]*$", "", text).strip()
            if not text:
                last_err = "empty response"
                time.sleep(min(1.5 * (2 ** attempt), 8.0))
                continue
            um = d.get("usageMetadata") or {}
            last_usage = ({"prompt_tokens": um.get("promptTokenCount"),
                           "completion_tokens": um.get("candidatesTokenCount"),
                           "total_tokens": um.get("totalTokenCount")} if um else None)
            last_latency_ms = int((time.time() - _t0) * 1000)
            return text, sources
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(min(1.5 * (2 ** attempt), 8.0))
            continue
    log.warning("gemini web search failed after %d tries: %s", attempt + 1, last_err)
    return "", []
