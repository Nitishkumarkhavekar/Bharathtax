"""Rotating 'suggested starter' questions for the empty chat screen.

Static cards get stale — the same six every visit, all day. This serves a
FRESH, shuffled mix each request: a daily LLM-generated 'trending' set (current
Indian income-tax topics, generated once per day and cached in Redis) blended
with a curated evergreen pool. Fail-open: if Redis or the LLM is unavailable we
simply shuffle the evergreen pool, so the screen is never empty.
"""
from __future__ import annotations

import datetime
import json
import os
import random

import httpx
import redis

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

_PREFIX = "bt:starters:trend:"
_TTL = 26 * 3600  # a little over a day so the day's set survives until refreshed
_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
_MODEL = os.getenv("GEMINI_FOLLOWUP_MODEL", "gemini-flash-latest")

# Curated, evergreen high-value questions across every module. Always available
# so the mix is sensible even before/without the daily trending call.
EVERGREEN = [
    {"category": "Deductions", "text": "What is the maximum deduction under section 80C?"},
    {"category": "Deductions", "text": "Deduction limit under section 80D for senior citizens"},
    {"category": "Deductions", "text": "NPS deduction under 80CCD(1B) over the 80C cap"},
    {"category": "Salary", "text": "Explain HRA exemption with a simple example"},
    {"category": "Salary", "text": "Standard deduction for salaried individuals — new vs old regime"},
    {"category": "Salary", "text": "Taxability of leave travel allowance (LTA)"},
    {"category": "Tax regime", "text": "New vs old tax regime — which is better and when?"},
    {"category": "Tax regime", "text": "Tax slab rates under the new regime for the current AY"},
    {"category": "Capital gains", "text": "How is long-term capital gain on equity taxed?"},
    {"category": "Capital gains", "text": "Section 54 exemption on sale of a residential house"},
    {"category": "Assessment", "text": "When is an addition under section 68 sustainable?"},
    {"category": "Assessment", "text": "Reassessment under section 148 — time limits and procedure"},
    {"category": "Assessment", "text": "Faceless assessment under section 144B — key steps"},
    {"category": "Appeals", "text": "Section 249(4) — condonation of delay in filing an appeal"},
    {"category": "Appeals", "text": "Appeal to CIT(A) vs revision under section 264"},
    {"category": "TDS", "text": "TDS default under section 201 — burden of proof principles"},
    {"category": "TDS", "text": "TDS on rent under section 194-I — rates and threshold"},
    {"category": "TDS", "text": "Consequences of non-deduction of TDS under section 40(a)(ia)"},
    {"category": "Penalties", "text": "Penalty under section 270A for under-reporting of income"},
    {"category": "Business", "text": "Presumptive taxation under section 44AD — eligibility"},
    {"category": "Business", "text": "Allowability of expenditure under section 37(1)"},
    {"category": "International tax", "text": "How is DTAA relief claimed under section 90?"},
    {"category": "Exemptions", "text": "Agricultural income — is it fully exempt under section 10(1)?"},
    {"category": "Filing", "text": "Which ITR form applies to a salaried individual?"},
]

_client: "redis.Redis | None" = None


def _redis() -> "redis.Redis | None":
    global _client
    if _client is None:
        try:
            _client = redis.Redis.from_url(
                settings.redis_url, socket_timeout=1.0, socket_connect_timeout=1.0,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("starters: redis init failed (%s)", exc)
            return None
    return _client


def _today() -> str:
    return datetime.date.today().isoformat()


def _trending() -> list[dict]:
    """Today's LLM-generated trending starters, cached for the day. [] on any failure."""
    if not _KEY:
        return []
    r = _redis()
    key = _PREFIX + _today()
    if r is not None:
        try:
            cached = r.get(key)
            if cached:
                return json.loads(cached)
        except Exception:  # noqa: BLE001
            pass
    try:
        prompt = (
            f"Today is {_today()}. Generate 8 'trending' starter questions an Indian "
            "income-tax officer might explore TODAY. Reflect current, topical matters: "
            "recent Union Budget / Finance Act changes, the current assessment year, "
            "new TDS/TCS rules, recent CBDT circulars and notifications, plus a couple of "
            "evergreen high-value topics. Vary the categories across Deductions, Salary, "
            "Capital gains, TDS, Appeals, Assessment, Tax regime, International tax, "
            "Penalties. Each question must be under 14 words, specific and useful. "
            'Return ONLY a JSON array of objects: {"category": "...", "text": "..."}.'
        )
        resp = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{_MODEL}:generateContent",
            headers={"x-goog-api-key": _KEY, "Content-Type": "application/json"},
            json={"contents": [{"parts": [{"text": prompt}]}],
                  # thinkingBudget=128 caps deliberation so the JSON array
                  # fits in maxOutputTokens. 0 rejects with 400 on
                  # gemini-flash-latest + responseMimeType=json; unset lets
                  # the model burn tokens on thinking and return a fragment.
                  "generationConfig": {"temperature": 0.7, "maxOutputTokens": 800,
                                       "responseMimeType": "application/json",
                                       "thinkingConfig": {"thinkingBudget": 128}}},
            timeout=12.0,
        )
        if resp.status_code != 200:
            return []
        txt = "".join(pt.get("text", "") for pt in
                      ((resp.json().get("candidates") or [{}])[0].get("content", {}) or {}).get("parts", []))
        arr = json.loads(txt)
        out = []
        for o in arr:
            if not isinstance(o, dict):
                continue
            c = str(o.get("category", "")).strip()
            t = str(o.get("text", "")).strip()
            if c and t and len(t) <= 120:
                out.append({"category": c, "text": t})
        out = out[:8]
        if r is not None and out:
            try:
                r.setex(key, _TTL, json.dumps(out))
            except Exception:  # noqa: BLE001
                pass
        return out
    except Exception as exc:  # noqa: BLE001
        log.warning("starters: trending generation failed (%s)", exc)
        return []


def get_starters(n: int = 6) -> list[dict]:
    """A shuffled mix of today's trending + evergreen starters, deduped."""
    pool = _trending() + EVERGREEN
    seen: set[str] = set()
    uniq: list[dict] = []
    for it in pool:
        k = it["text"].strip().lower()
        if k not in seen:
            seen.add(k)
            uniq.append(it)
    random.shuffle(uniq)
    # Prefer distinct categories so the six cards look varied, then top up.
    picked: list[dict] = []
    used: set[str] = set()
    for it in uniq:
        if it["category"].lower() not in used:
            picked.append(it)
            used.add(it["category"].lower())
        if len(picked) >= n:
            break
    if len(picked) < n:
        for it in uniq:
            if it not in picked:
                picked.append(it)
            if len(picked) >= n:
                break
    return picked[:n]
