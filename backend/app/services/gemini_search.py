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
# Primary model is Pro for answer quality; failover to Flash on per-model
# quota / availability errors so the officer still gets an answer.
# `GEMINI_SEARCH_MODEL` sets the primary; `GEMINI_SEARCH_FALLBACK_MODELS`
# (comma-separated) sets the failover chain tried in order on 404/429/5xx.
_MODEL = os.getenv("GEMINI_SEARCH_MODEL", "gemini-2.5-pro")
_FALLBACK_MODELS = tuple(
    m.strip() for m in os.getenv(
        "GEMINI_SEARCH_FALLBACK_MODELS",
        "gemini-pro-latest,gemini-flash-latest,gemini-2.5-flash",
    ).split(",") if m.strip() and m.strip() != _MODEL
)
_ENABLED = os.getenv("WEB_SEARCH_ENABLED", "1").lower() not in ("0", "false", "no", "")
_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
# Output-token cap. Officer replies are typically 200-400 words (~600 tokens),
# so 1200 gives ample headroom without paying for a 2600-token ceiling every
# time. Bring it up via env if answers are getting cut off.
_MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_SEARCH_MAX_OUTPUT", "1200"))
# Thinking-budget cap for search calls. Flash 3.5 defaults to spending ~1400
# thinking tokens per grounded call which doubles latency (30s → 15s). 512 is
# the measured sweet spot: full answer + 10+ sources in ~10s. Only Flash/Pro
# 3.x accept a numeric budget; setting to 0 breaks some model versions with
# 400 INVALID_ARGUMENT — leave unset (empty string / <0) to let the model
# auto-decide.
_THINKING_BUDGET = os.getenv("GEMINI_SEARCH_THINKING_BUDGET", "").strip()

# Officer-facing SOURCE POLICY. We only surface citations from authoritative or
# established outlets — government, courts/tribunals, primary case-law databases,
# and major legal/business press. Consumer tax-filing and advisory blogs
# (eqvista, tax2win, cleartax, treelife, …) are dropped: citing them to a
# Commissioner reads as unserious even when the prose is fine. The model still
# writes its answer; we just don't attach a low-credibility chip to it.
# Override the allowlist via WEB_SOURCE_ALLOWLIST (comma-separated substrings).
# Root tokens (not full subdomains) so we match whatever domain form the search
# returns — "economictimes.com" and "economictimes.indiatimes.com" both hit
# "economictimes". Government (.gov.in/.nic.in) covers every dept & court portal.
_DEFAULT_ALLOW = (
    ".gov.in,.nic.in,indiankanoon,itatonline,taxmann,taxsutra,taxscan,"
    "barandbench,livelaw,scconline,economictimes,livemint,business-standard,"
    "financialexpress,thehindu,moneycontrol,prsindia"
)
_ALLOW = tuple(s.strip().lower() for s in
               os.getenv("WEB_SOURCE_ALLOWLIST", _DEFAULT_ALLOW).split(",") if s.strip())


def _reputable(domain_or_title: str) -> bool:
    """True if the source domain is on the officer-grade allowlist."""
    d = (domain_or_title or "").lower()
    return any(a in d for a in _ALLOW)

# Telemetry from the most recent web_answer() call, mirroring OpenAICompatLLM's
# last_* attributes so the chat route can bill the Gemini token spend.
last_usage: dict | None = None
last_model: str | None = None
last_latency_ms: int | None = None

# Trimmed system prompt. Every non-essential word here costs prompt tokens on
# every single web-search call, so we keep it tight. Concrete instructions
# (source preference, output style, no inline citation markers) survive.
_SYS = (
    "Indian income-tax assistant. You MUST call the google_search tool FIRST "
    "for every question — even seemingly-common ones — then answer strictly "
    "from what search returned. Prefer incometax.gov.in / incometaxindia.gov.in "
    "/ indiankanoon / itatonline / taxmann / livelaw. Be precise on section "
    "numbers, limits, dates, and AY. If search returned nothing usable, say so. "
    "Never invent a citation.\n"
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
    """Insert {{cite:domain|url}} markers at each grounded segment end using Gemini's
    groundingSupports (segment byte-offsets -> source chunk indices). The UI turns
    each marker into a small favicon chip linking to that source. The url is the
    grounding-redirect that resolves to the exact page (e.g. a specific YouTube
    video), so the chip must NOT be reduced to the bare domain."""
    if not text or not supports or not chunks:
        return (text or "").strip()
    by_end: dict = {}
    for sup in supports:
        seg = sup.get("segment") or {}
        end = seg.get("endIndex")
        if end is None:
            continue
        pairs: list = []
        for ci in (sup.get("groundingChunkIndices") or []):
            if isinstance(ci, int) and 0 <= ci < len(chunks):
                web = chunks[ci].get("web") or {}
                dm = _domain_of(web.get("title") or "")
                uri = (web.get("uri") or "").strip()
                if dm and _reputable(dm) and (dm, uri) not in pairs:
                    pairs.append((dm, uri))
        if pairs:
            slot = by_end.setdefault(int(end), [])
            for pair in pairs:
                if pair not in slot:
                    slot.append(pair)
    if not by_end:
        return text.strip()
    b = text.encode("utf-8")
    for end in sorted(by_end, reverse=True):
        marker = "".join("{{cite:%s|%s}}" % (dm, uri) for dm, uri in by_end[end][:2])
        e = max(0, min(int(end), len(b)))
        b = b[:e] + marker.encode("utf-8") + b[e:]
    return b.decode("utf-8", errors="ignore").strip()


def web_answer(question: str) -> tuple[str, list[dict]]:
    """Return (answer_text, [{'title','url'}, ...]); ('', []) on failure/disabled.

    Tries the primary model first; on 404/429/5xx or per-model 4xx errors
    (e.g. thinking-budget rejection), cascades through _FALLBACK_MODELS so
    a quota-exhausted or retired top-tier model doesn't leave the officer
    with no answer.
    """
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
    gen_cfg = {"temperature": 0.2, "maxOutputTokens": _MAX_OUTPUT_TOKENS}
    if _THINKING_BUDGET:
        try:
            tb = int(_THINKING_BUDGET)
            # Only inject when strictly positive — 0 breaks gemini-3.1-pro-preview,
            # and negative means "let the model decide" (skip).
            if tb > 0:
                gen_cfg["thinkingConfig"] = {"thinkingBudget": tb}
        except ValueError:
            pass
    body = {
        "systemInstruction": {"parts": [{"text": dated_sys}]},
        "contents": [{"role": "user", "parts": [{"text": question}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": gen_cfg,
    }
    last_err = None
    model_chain = (_MODEL,) + _FALLBACK_MODELS
    # Wall-clock budget: never spend more than this on a single web_answer call,
    # no matter how many models we cycle or how many retries the transient
    # policy allows. Prevents a Gemini 503 storm from turning one question into
    # a 4-minute wait. Overridable via env.
    _budget_ms = int(os.getenv("GEMINI_SEARCH_TIMEOUT_MS", "22000"))
    for m_idx, model in enumerate(model_chain):
        if (time.time() - _t0) * 1000 >= _budget_ms:
            log.warning("web search wall-clock budget exhausted after %dms", _budget_ms)
            break
        last_model = model
        # 1 attempt per model, no exponential-backoff sleep. Prior version
        # slept up to 1.5+3+6=10.5s per model on 5xx; with 3 models that was
        # 30s of pure sleep before falling through. On a genuinely down key,
        # a fast fail-through to the next model is dramatically better than
        # patient retry.
        try:
            with httpx.Client(timeout=httpx.Timeout(15.0)) as c:
                r = c.post(f"{_BASE}/{model}:generateContent",
                           headers={"x-goog-api-key": _KEY, "Content-Type": "application/json"},
                           json=body)
            if r.status_code in (400, 404, 429) or r.status_code >= 500:
                last_err = f"{model} HTTP {r.status_code}"
                log.warning("web search %s HTTP %s — falling to next model", model, r.status_code)
                continue  # try next model in chain
            if r.status_code != 200:
                log.warning("web search %s HTTP %s: %s", model, r.status_code, r.text[:200])
                continue
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
                if uri and uri not in seen and _reputable(title):
                    seen.add(uri)
                    sources.append({"title": title, "url": uri})
            text = _insert_inline_cites(raw_text, gm.get("groundingSupports") or [], chunks)
            text = re.sub(r"\s*\[[\d.,\s]+\]", "", text)
            text = re.sub(r"\s*\[[\d.,\s]*$", "", text).strip()
            if not text:
                last_err = f"{model} empty response"
                continue
            um = d.get("usageMetadata") or {}
            last_usage = ({"prompt_tokens": um.get("promptTokenCount"),
                           "completion_tokens": um.get("candidatesTokenCount"),
                           "total_tokens": um.get("totalTokenCount")} if um else None)
            last_latency_ms = int((time.time() - _t0) * 1000)
            if m_idx > 0:
                log.info("web search recovered on fallback model %s (primary %s failed)", model, _MODEL)
            return text, sources
        except Exception as e:  # noqa: BLE001
            last_err = f"{model} {type(e).__name__}: {e}"
            continue
    log.warning("gemini web search failed on all models (%s): %s",
                ", ".join(model_chain), last_err)
    return "", []
