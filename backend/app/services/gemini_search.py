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
_MODEL = os.getenv("GEMINI_SEARCH_MODEL", "gemini-flash-latest")
_ENABLED = os.getenv("WEB_SEARCH_ENABLED", "1").lower() not in ("0", "false", "no", "")
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# Telemetry from the most recent web_answer() call, mirroring OpenAICompatLLM's
# last_* attributes so the chat route can bill the Gemini token spend.
last_usage: dict | None = None
last_model: str | None = None
last_latency_ms: int | None = None

_SYS = (
    "You are an assistant on Indian income-tax law. Answer the user's question using current web "
    "information. STRONGLY PREFER official Government of India sources — incometax.gov.in, "
    "incometaxindia.gov.in, and CBDT circulars/notifications. Be precise about section numbers, "
    "monetary limits, dates and the assessment year. If sources conflict or you are unsure, say so. "
    "Never invent a citation.\n"
    "WRITING RULES: Write clean, plain prose — a short paragraph or a few '- ' bullet points. Do NOT "
    "put inline citation markers, footnote numbers, or bracketed reference numbers such as [1] or "
    "[1.1.2] anywhere in the text; the sources are listed separately below your answer. Keep it "
    "concise and always finish your sentences — never stop mid-list."
)


def available() -> bool:
    return bool(_KEY) and _ENABLED


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
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2600},
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
            text = "".join(p.get("text", "") for p in parts).strip()
            # Strip any inline bracketed reference/citation clutter the model still emits
            # (e.g. "[1.1.2, 1.1.3, 2.1.1]" or a trailing unclosed "[1.1.2,") — we render a
            # clean Sources list separately.
            text = re.sub(r"\s*\[[\d.,\s]+\]", "", text)
            text = re.sub(r"\s*\[[\d.,\s]*$", "", text).strip()
            if not text:
                last_err = "empty response"
                time.sleep(min(1.5 * (2 ** attempt), 8.0))
                continue
            sources: list[dict] = []
            gm = cand.get("groundingMetadata") or {}
            seen = set()
            for ch in (gm.get("groundingChunks") or []):
                web = ch.get("web") or {}
                uri = web.get("uri")
                title = web.get("title") or uri or ""
                if uri and uri not in seen:
                    seen.add(uri)
                    sources.append({"title": title, "url": uri})
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
