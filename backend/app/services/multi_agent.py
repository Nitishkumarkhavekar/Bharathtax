"""Two-agent research + composition pipeline.

Splits the answer path into two focused specialists:

  1. RESEARCHER — Gemini with the search tools. Its ONLY job is to gather
     every relevant statute, rule, circular and precedent for the question
     and return them as a structured evidence packet. It does NOT format
     the final answer. Non-streaming.

  2. COMPOSER — Gemini WITHOUT tools. Receives the question + evidence
     packet + the 7-section response template. Writes the streaming
     answer. Focuses purely on clarity, structure, regime distinctions,
     and practical mechanic — never guesses statutes since the packet is
     the source of truth.

Feature-flagged with MULTI_AGENT_ENABLED. When off, ask.py uses the
existing single-agent path in agent.py (unchanged).
"""
from __future__ import annotations

import json
import logging
import os
import re
import time

import httpx
from sqlalchemy.orm import Session

from app.services import agent as _single_agent

log = logging.getLogger("multi_agent")

# Reuse the same Gemini config / auth / retry helper as the single agent.
from app.services import gemini_transport as _tx
_KEY = _single_agent._KEY
_BASE = _single_agent._BASE
_TOOLS = _single_agent._TOOLS

import contextvars
# Per-request token-usage sink. The multi-agent path previously reported
# llm_calls=[] so its Gemini spend was invisible in token_usage. Each sub-agent
# call records here; the orchestrator seeds it and hands it back in `done`.
_usage_sink: "contextvars.ContextVar" = contextvars.ContextVar("_mt_usage_sink", default=None)


def _rec_usage(model: str, resp_json, t0=None) -> None:
    """Append one Gemini call's token usage to the per-request sink (if set).
    Also captures cachedContentTokenCount to monitor the implicit-cache hit rate."""
    sink = _usage_sink.get()
    if sink is None:
        return
    um = (resp_json or {}).get("usageMetadata") or {}
    sink.append({
        "model": model,
        "usage": {"prompt_tokens": um.get("promptTokenCount"),
                  "completion_tokens": um.get("candidatesTokenCount"),
                  "total_tokens": um.get("totalTokenCount"),
                  "cached_tokens": um.get("cachedContentTokenCount")},
        "latency_ms": int((time.time() - t0) * 1000) if t0 else None,
    })
_TOOL_STATUS = _single_agent._TOOL_STATUS
_exec_tool = _single_agent._exec_tool
_exec_tool_isolated = _single_agent._exec_tool_isolated
_recent_history = _single_agent._recent_history
_apply_continuation_intent = _single_agent._apply_continuation_intent

# --- SPEED TUNING ---------------------------------------------------------
# Each agent runs on the tier that fits its job. Defaults are pinned to
# `gemini-flash-latest` (the only tier confirmed to work across API keys in
# this project — pinned 2.5-flash and flash-lite have returned 404/400 for
# some keys). All three overridable via env; set MULTI_AGENT_*_MODEL to
# force a specific model. A FALLBACK model is used if the primary call
# returns a hard error (404 no-such-model, 400 bad-request, etc.) — see
# _post_with_model_fallback below.
_FALLBACK_MODEL = os.getenv("MULTI_AGENT_FALLBACK_MODEL", "gemini-flash-latest")
_PLANNER_MODEL = os.getenv("MULTI_AGENT_PLANNER_MODEL", _FALLBACK_MODEL)
_RESEARCHER_MODEL = os.getenv("MULTI_AGENT_RESEARCHER_MODEL", _FALLBACK_MODEL)
_COMPOSER_MODEL = os.getenv("MULTI_AGENT_COMPOSER_MODEL", _FALLBACK_MODEL)


def _post_gemini(model: str, path: str, body: dict, timeout: float = 60.0):
    """POST to Gemini with:
      1. Automatic single-shot fallback to _FALLBACK_MODEL on 400/404
         when the primary model differs (model-not-available for this
         API key).
      2. Retry-with-backoff on 429/503 and on 400 responses whose body
         looks like a rate-limit or quota exhaustion (Google returns
         400 INVALID_ARGUMENT sometimes for RPM violations, especially
         when a burst of parallel planner/coverage/researcher calls
         hits the per-minute limit).
    Returns the final httpx.Response so caller can inspect status_code.
    """
    url = f"{_BASE}/{model}:{path}"
    headers = {"x-goog-api-key": _KEY, "Content-Type": "application/json"}

    def _once(u: str) -> httpx.Response:
        with httpx.Client(timeout=httpx.Timeout(timeout)) as c:
            return c.post(u, headers=headers, json=body)

    def _looks_ratelimit(r: httpx.Response) -> bool:
        # Explicit rate signals — retry.
        if r.status_code in (429, 503):
            return True
        # 400 INVALID_ARGUMENT — Google frequently returns this instead
        # of 429 when the per-minute quota trips on Gemini, and the body
        # only says "Request contains an invalid argument" with no
        # actionable detail. We treat any 400 whose body either mentions
        # rate/quota OR is the generic INVALID_ARGUMENT wrapper as
        # potentially transient and worth ONE quick retry. A genuinely
        # malformed request will fail again after the first retry and
        # surface to the caller unchanged.
        if r.status_code == 400:
            try:
                body_txt = r.text.lower()
            except Exception:  # noqa: BLE001
                return False
            if any(k in body_txt for k in (
                "rate", "quota", "resource_exhausted", "resource has been",
                "too many", "exceeded",
            )):
                return True
            # Generic INVALID_ARGUMENT wrapper — Google's most common
            # response when its own gateway coalesces a rate hit into 400.
            return "invalid_argument" in body_txt or "invalid argument" in body_txt
        return False

    r = _once(url)
    # Retry-with-backoff for transient rate/quota limits — 3 tries,
    # exponential 1s / 3s / 6s. Total added latency worst-case ~10s,
    # which is far preferable to failing outright.
    if _looks_ratelimit(r):
        for _wait in (1.0, 3.0, 6.0):
            log.info("gemini %s rate-limit signal (HTTP %s) — sleeping %.1fs",
                     model, r.status_code, _wait)
            time.sleep(_wait)
            r = _once(url)
            if r.status_code == 200:
                break
            if not _looks_ratelimit(r):
                break

    if r.status_code in (400, 404) and model != _FALLBACK_MODEL:
        log.warning("gemini %s returned %s on %s — retrying on %s",
                    model, r.status_code, path, _FALLBACK_MODEL)
        fallback_url = f"{_BASE}/{_FALLBACK_MODEL}:{path}"
        r = _once(fallback_url)
    return r
# Cap the researcher's tool-loop tightly — 3 rounds is enough for a well-
# focused packet, and each saved round is ~1-2 seconds off the total.
_RESEARCHER_MAX_ITERS = int(os.getenv("MULTI_AGENT_RESEARCHER_MAX_ITERS", "3"))


# ============================================================================
# DETERMINISTIC TYPO / SPELLING NORMALISER
# ----------------------------------------------------------------------------
# Runs BEFORE any LLM call. Instant, zero-cost, 100% reliable for the known
# tax-domain typos our users make. Anything not in this table falls through
# to the planner's prompt-level rules as a soft backup.
# ============================================================================
_TYPO_DICT = {
    # ESOP-related mangling
    r"\befos\b":   "ESOP",
    r"\befps\b":   "ESOP",
    r"\besops\b":  "ESOP",
    r"\bE\.?S\.?O\.?P\.?\b": "ESOP",
    r"\bemployee stock ownersh?ip plan\b": "Employee Stock Ownership Plan",

    # GST
    r"\bgts\b":    "GST",
    r"\bgood\s*and\s*service\s*tax\b": "GST",
    r"\bgoods\s+and\s+services\s+tax\b": "GST",

    # TDS / TCS
    r"\btdr\b":    "TDS",
    r"\btax\s+deduc?t?ion\s+at\s+source\b": "TDS",
    r"\btax\s+collec?t?ion\s+at\s+source\b": "TCS",

    # Statutory / procedural bodies
    r"\bcita\b":   "CIT(A)",
    r"\bcit\s*[-\s]?a\b": "CIT(A)",
    r"\bitar\b":   "ITAT",
    r"\bitart\b":  "ITAT",
    r"\bassessing officier\b": "Assessing Officer",
    r"\bassessing officr\b":   "Assessing Officer",
    r"\bao's\b":   "AO's",

    # Well-known parties in landmark cases
    r"\binfosis\b":     "Infosys",
    r"\binfoysis\b":    "Infosys",
    r"\binfossys\b":    "Infosys",
    r"\bvodapone\b":    "Vodafone",
    r"\bvodaphone\b":   "Vodafone",
    r"\bvodafon\b":     "Vodafone",
    r"\bkelvinater\b":  "Kelvinator",
    r"\bkelvineter\b":  "Kelvinator",
    r"\blovley\s+export\b": "Lovely Exports",
    r"\blovely\s+export\b": "Lovely Exports",
    r"\bnra\s+iron\s*&?\s*steal\b": "NRA Iron & Steel",
    r"\bgkn\s+driveshaft\b":  "GKN Driveshafts",

    # Common section-name typos
    r"\bscetion\b":    "Section",
    r"\bsecion\b":     "Section",
    r"\bincometax\b":  "Income-tax",
    r"\bincome tax act 1961\b": "Income-tax Act, 1961",
    r"\bexemtion\b":   "exemption",
    r"\bdeducion\b":   "deduction",
    r"\bdisallowence\b": "disallowance",
    r"\bassesee\b":    "assessee",
    r"\bassessee's\b": "assessee's",
    r"\bwithholding tex\b": "withholding tax",

    # HRA / rent / regime
    r"\bhouse rent allowence\b": "House Rent Allowance (HRA)",
    r"\bpresumptive taxion\b":   "presumptive taxation",
    r"\bnew regieme\b":  "new regime",
    r"\bold regieme\b":  "old regime",
}


# ============================================================================
# LANDMARK CASE PRIMER
# ----------------------------------------------------------------------------
# Deterministic case briefs for the well-known cases users ask about. When
# the user's question matches one of these regex patterns, we PREPEND the
# primer to the composer's evidence packet — so the composer has the correct
# case material in its context even if the researcher's tool returned an
# off-topic result. This bypasses the "LLM ignores prompt rule" failure mode
# by making the fix a hard code-level intervention.
# ============================================================================
_LANDMARK_CASE_PRIMER: dict[str, str] = {
    # Flipkart ESOP — the case Instakart searches keep polluting.
    r"flipkart\s+(esop|e\.?s\.?o\.?p\.?)": (
        "## PRIMER: Flipkart ESOP Case (from BharatTax curated case index)\n"
        "**Case:** Flipkart India Pvt Ltd vs ACIT (2018) 79 taxmann.com 251 (Bangalore ITAT)\n"
        "**Leading Precedent (followed):** Biocon Ltd vs DCIT (2020) 430 ITR 151 (Karnataka HC, Full Bench)\n"
        "**Provision:** Section 37(1) of the Income-tax Act, 1961 (revenue-expenditure deduction)\n"
        "**Issue:** Whether the ESOP discount — the difference between the "
        "market price of shares on the vesting date and the exercise price "
        "at which employees may acquire them — is a deductible revenue "
        "expenditure, or whether it is a contingent / notional / capital "
        "outlay that must be disallowed.\n"
        "**Holding:** The Bangalore ITAT held that the ESOP discount IS a "
        "deductible revenue expenditure under Section 37(1). It followed the "
        "Karnataka HC Full Bench ruling in Biocon Ltd vs DCIT.\n"
        "\n"
        "**ESOP TIMELINE (mechanism the answer MUST explain):**\n"
        "  1. GRANT DATE — employer grants options to the employee; no tax "
        "event yet, but the accounting cost begins to accrue.\n"
        "  2. VESTING PERIOD — the period (usually 1-4 years) over which "
        "the employee earns the right to exercise. The ESOP discount is "
        "recognised as an employer expense PRO-RATA over this period.\n"
        "  3. VESTING DATE — the option is now exercisable. FMV on this "
        "date fixes the perquisite value for the employee.\n"
        "  4. EXERCISE DATE — employee pays the exercise price and receives "
        "the shares. The employer's Sec 37(1) claim crystallises here.\n"
        "  5. SALE DATE — employee sells the shares. Capital-gains tax at "
        "this stage (LTCG / STCG depending on holding period from exercise).\n"
        "\n"
        "**REVENUE'S THREE ARGUMENTS (and why each was rejected):**\n"
        "  (a) CONTINGENT — 'discount only crystallises if the employee "
        "actually exercises the option'. REJECTED because the obligation is "
        "measurable at grant/vesting; forfeitures are handled by a matching "
        "adjustment (see below), not by disallowing the whole deduction.\n"
        "  (b) NOTIONAL / NO CASH OUTFLOW — 'no cash leaves the company, so "
        "there is no expenditure'. REJECTED because Sec 37(1) does not "
        "require cash outflow; it requires that a cost be laid out or "
        "expended wholly and exclusively for the business. The discount is "
        "a REAL cost — the company forgoes the premium it could have "
        "received had it issued the same shares at market price. That "
        "foregone consideration is the price of securing employee services.\n"
        "  (c) CAPITAL EXPENDITURE — 'share issuance is a capital "
        "transaction'. REJECTED because the character of the outlay is not "
        "determined by the mode of settlement; it is determined by its "
        "PURPOSE. Purpose here is to compensate employees for services — "
        "quintessentially revenue.\n"
        "\n"
        "**NUMERICAL ILLUSTRATION the answer MUST include:**\n"
        "  Grant: 1,00,000 options at exercise price Rs 100. "
        "Vesting period: 4 years (25% per year). "
        "FMV on vesting date each year: Rs 200.\n"
        "  Discount per option = Rs 200 - Rs 100 = Rs 100.\n"
        "  Total discount = 1,00,000 x Rs 100 = Rs 1,00,00,000.\n"
        "  Deduction per year u/s 37(1) = Rs 1,00,00,000 / 4 = "
        "Rs 25,00,000 pro-rata over the vesting period.\n"
        "  If employees forfeit 10% (say resign before full vesting), the "
        "employer REVERSES the corresponding proportion of the deduction "
        "in the year of forfeiture — this is the matching adjustment that "
        "defeats the 'contingent' argument.\n"
        "\n"
        "**Related judgment (contra view resolved by Biocon FB):** "
        "PCIT vs LG Electronics India Pvt Ltd — earlier Delhi Bench view "
        "treated ESOP discount as contingent; overruled by Karnataka HC FB.\n"
        "**Practical takeaway:** Claim the discount pro-rata over the "
        "vesting period; reverse the deduction for forfeited options; "
        "ensure FMV is per Rule 3(8) methodology.\n"
    ),
    # Infosys ESOP — the classic perquisite-valuation case.
    r"infosys\s+(esop|e\.?s\.?o\.?p\.?)": (
        "## PRIMER: Infosys ESOP Case (from BharatTax curated case index)\n"
        "**Case:** CIT vs Infosys Technologies Ltd (2008) 297 ITR 167 (SC)\n"
        "**Provision:** Section 17(2) of the Income-tax Act, 1961 "
        "(perquisite in salary)\n"
        "**Issue:** For AY 1997-98 to 2000-01 (pre-amendment), whether the "
        "difference between the market price and the exercise price of "
        "shares allotted to employees under an ESOP was a perquisite "
        "chargeable to tax as salary under Sec 17(2).\n"
        "**Holding:** The Supreme Court held it was NOT a perquisite under "
        "the pre-2000 Sec 17(2). The benefit was contingent (depended on "
        "the market movement + employee holding the shares) and there was "
        "no cost incurred by the employer that could be quantified as a "
        "perquisite paid to the employee.\n"
        "**Ratio (short):** A perquisite under Sec 17(2) requires a "
        "monetary benefit paid or incurred by the employer for the "
        "employee's benefit; a mere right to acquire shares at a lower "
        "price is not itself a perquisite unless the statute so specifies.\n"
        "**Note on subsequent law:** Sec 17(2)(iiia) [inserted 2000, later "
        "renumbered to Sec 17(2)(vi)] now expressly makes ESOP benefits a "
        "perquisite. Infosys governs the position for the pre-2000 window "
        "only; the modern position is statutory.\n"
    ),
    # Vodafone offshore transfer.
    r"\bvodafone\b": (
        "## PRIMER: Vodafone Case (from BharatTax curated case index)\n"
        "**Case:** Vodafone International Holdings BV vs UOI (2012) 341 ITR "
        "1 (SC) [reversed by Finance Act 2012 retrospective amendment to "
        "Sec 9(1)(i); later resolved by the 2021 Taxation Laws (Amendment) "
        "Act]\n"
        "**Provision:** Section 9(1)(i) of the Income-tax Act, 1961 "
        "(income deemed to accrue in India from transfer of a capital "
        "asset situate in India)\n"
        "**Issue:** Whether the offshore transfer of shares of a foreign "
        "company (Cayman Islands SPV) that indirectly held an Indian "
        "operating company was chargeable to Indian capital-gains tax + "
        "attracted TDS obligations on the purchaser.\n"
        "**Holding (SC 2012):** The transfer was NOT taxable in India — "
        "Sec 9(1)(i) as then worded did not cover indirect transfers "
        "through offshore share sales. Vodafone had no TDS obligation.\n"
        "**Aftermath:** Finance Act 2012 amended Sec 9(1)(i) "
        "retrospectively to bring indirect transfers within the tax net; "
        "the 2021 Taxation Laws (Amendment) Act rolled back retrospective "
        "operation for transactions before 28 May 2012.\n"
    ),
    # Biocon (Full Bench) — separate lookup path.
    r"\bbiocon\b.*(esop|e\.?s\.?o\.?p\.?)": (
        "## PRIMER: Biocon ESOP Case (from BharatTax curated case index)\n"
        "**Case:** Biocon Ltd vs DCIT (2020) 430 ITR 151 (Karnataka HC, "
        "Full Bench)\n"
        "**Provision:** Section 37(1) of the Income-tax Act, 1961\n"
        "**Issue:** Whether the ESOP discount is a deductible business "
        "expenditure.\n"
        "**Holding:** YES — the discount on ESOPs granted to employees is "
        "a deductible revenue expenditure under Sec 37(1). It represents "
        "the cost of securing employee services and is a real, "
        "ascertained business cost — not contingent, not notional, not "
        "capital.\n"
        "**Ratio:** Employee compensation via ESOP is a substituted form "
        "of salary; the discount is the employer's cost and qualifies for "
        "Sec 37(1) deduction spread over the vesting period.\n"
        "**Impact:** Landmark authority followed by later ITAT and HC "
        "benches (including Flipkart India Pvt Ltd vs ACIT).\n"
    ),
    # Lovely Exports — Sec 68 identity.
    r"\blovely\s+exports?\b": (
        "## PRIMER: Lovely Exports Case (from BharatTax curated case index)\n"
        "**Case:** CIT vs Lovely Exports (P) Ltd (2008) 216 CTR 195 (SC)\n"
        "**Provision:** Section 68 of the Income-tax Act, 1961 (cash credits)\n"
        "**Issue:** Whether an addition under Sec 68 for share application "
        "money is sustainable when the assessee has furnished the identity "
        "of the share applicants along with PAN and Return details.\n"
        "**Holding:** No. If share-applicant identity is established, the "
        "burden shifts to the Revenue to enquire into the applicants' "
        "creditworthiness. Addition in the assessee-company's hands is not "
        "sustainable; the Revenue's remedy lies against the applicants.\n"
        "**Ratio:** Identity alone shifts the initial onus; sustained "
        "additions require the AO to demonstrate the transaction is not "
        "genuine, not merely that the applicant is a paper entity.\n"
        "**Note:** Distinguished / narrowed by PCIT vs NRA Iron & Steel "
        "(P) Ltd (2019) 412 ITR 161 (SC), which held identity is not "
        "enough where creditworthiness is manifestly absent.\n"
    ),
    # Kelvinator — reassessment 'reason to believe'.
    r"\bkelvinator\b": (
        "## PRIMER: Kelvinator Case (from BharatTax curated case index)\n"
        "**Case:** CIT vs Kelvinator of India Ltd (2010) 320 ITR 561 (SC)\n"
        "**Provision:** Section 147 / 148 of the Income-tax Act, 1961 "
        "(reassessment)\n"
        "**Issue:** Whether reassessment under Sec 147 can be initiated on "
        "a 'mere change of opinion' by a successor AO.\n"
        "**Holding:** No. 'Reason to believe' under Sec 147 must be based "
        "on tangible material coming to the AO's notice; a mere change of "
        "opinion on the same facts already considered in the original "
        "assessment does NOT constitute 'reason to believe' and cannot "
        "sustain reassessment.\n"
        "**Ratio:** Reassessment is a safeguard against escaped income, "
        "not a review mechanism; the AO cannot re-open on the same facts "
        "with a different view.\n"
    ),
    # GKN Driveshafts — procedure for reassessment challenge.
    r"gkn\s+driveshafts?": (
        "## PRIMER: GKN Driveshafts Case (from BharatTax curated index)\n"
        "**Case:** GKN Driveshafts (India) Ltd vs ITO (2003) 259 ITR 19 (SC)\n"
        "**Provision:** Section 148 of the Income-tax Act, 1961\n"
        "**Issue:** Procedure to be followed when the assessee wishes to "
        "challenge the validity of a reassessment notice.\n"
        "**Holding:** On receipt of a Sec 148 notice, the assessee must (a) "
        "file a return, (b) request the reasons recorded, and (c) file "
        "objections to those reasons. The AO must dispose of the objections "
        "by a SPEAKING order BEFORE proceeding with the reassessment.\n"
        "**Ratio:** GKN sets the mandatory pre-assessment procedure; "
        "non-compliance vitiates the reassessment.\n"
    ),
    # NRA Iron & Steel — Sec 68 creditworthiness.
    r"nra\s+iron": (
        "## PRIMER: NRA Iron & Steel Case (from BharatTax curated index)\n"
        "**Case:** PCIT vs NRA Iron & Steel (P) Ltd (2019) 412 ITR 161 (SC)\n"
        "**Provision:** Section 68 of the Income-tax Act, 1961\n"
        "**Issue:** Whether identity of share applicants is sufficient to "
        "discharge the assessee's onus under Sec 68 when creditworthiness "
        "is manifestly absent.\n"
        "**Holding:** No. Where the AO has demonstrated that the share "
        "applicants are paper / shell entities with no genuine income or "
        "means, identity + PAN + Return alone do NOT discharge the onus. "
        "The assessee must also prove creditworthiness and genuineness. "
        "Narrows Lovely Exports.\n"
        "**Ratio:** Sec 68 onus is TRIPARTITE — identity + creditworthiness "
        "+ genuineness; all three must be discharged.\n"
    ),
}


def _match_case_primer(question: str) -> str:
    """Return concatenated primer text for every landmark case pattern that
    matches the question. Empty string when none match."""
    if not question:
        return ""
    primers: list[str] = []
    q = question or ""
    for pat, primer in _LANDMARK_CASE_PRIMER.items():
        if re.search(pat, q, re.IGNORECASE):
            primers.append(primer)
    if not primers:
        return ""
    return "\n\n".join(primers)


def _normalise_query(question: str) -> tuple[str, str]:
    """Apply deterministic typo/spelling fixes to a user question.
    Returns (corrected_question, note). `note` is a short human-readable
    summary of what was changed (empty string if nothing changed) — the
    composer surfaces this in the opening paragraph so the user knows.
    """
    if not question:
        return question, ""
    corrected = question
    changes: list[tuple[str, str]] = []
    for pat, repl in _TYPO_DICT.items():
        rx = re.compile(pat, re.IGNORECASE)
        def _sub(m):
            src = m.group(0)
            # Skip no-op self-replacements (e.g. matching "ESOP" and
            # substituting the same "ESOP") — they don't change the text
            # and shouldn't appear in the user-facing correction note.
            if src.lower() != repl.lower():
                changes.append((src, repl))
            return repl
        corrected = rx.sub(_sub, corrected)
    if not changes:
        return question, ""
    # De-dup changes (case-insensitive on the source) and build the note.
    seen = set()
    unique = []
    for src, tgt in changes:
        k = (src.lower(), tgt.lower())
        if k in seen:
            continue
        seen.add(k)
        unique.append((src, tgt))
    note = ", ".join(f'"{s}" -> "{t}"' for s, t in unique)
    return corrected, note


def enabled() -> bool:
    """Multi-agent is opt-in via env, and requires the API key + the
    single-agent to also be enabled (we still use its tool infra)."""
    return (
        _tx.available()
        and os.getenv("MULTI_AGENT_ENABLED", "0").lower() in ("1", "true", "yes")
        and _single_agent.enabled()
    )


# ============================================================================
# PLANNER agent — tiny fast call that decomposes the question into a plan.
# Emits JSON: {issue, sub_topics[], likely_sections_to_include}.
# The researcher uses `sub_topics` to focus its tool calls; the composer
# uses `likely_sections_to_include` to know which of Sections 4/5 to keep.
# ============================================================================
_PLANNER_SYSTEM = (
    "You are BharatTax's PLANNER agent. Given the user's tax question, "
    "produce a compact JSON plan that guides the downstream research + "
    "composition agents. Return ONLY the JSON — no prose, no markdown.\n"
    "\n"
    "BEFORE PLANNING — normalise the question:\n"
    "- Silently correct obvious typos and OCR-mangled tax terms. "
    "Common corrections: EFOS/EFPS/EFO -> ESOP (Employee Stock Ownership "
    "Plan); GTS/GTS -> GST; TCS/TDR -> TDS; 194IB -> Sec 194-IB; ITR/ITAR "
    "-> Income Tax Return / ITAT depending on context; 80c -> Sec 80C; "
    "CITA -> CIT(A); AS -> Assessment Order; RE -> reassessment.\n"
    "- Recognise well-known cases by their party name even if the user "
    "writes the topic informally. LANDMARK CASE INDEX (use these EXACT "
    "citations in sub_topics when the user mentions the party/topic):\n"
    "    * 'infosys ESOP' -> CIT vs Infosys Technologies Ltd (2008) 297 "
    "ITR 167 (SC) — ESOP perquisite valuation under Sec 17(2).\n"
    "    * 'flipkart ESOP' -> Flipkart India Pvt Ltd vs ACIT (2018) 79 "
    "taxmann.com 251 (Bangalore ITAT) — ESOP discount deductibility "
    "under Sec 37(1). Related: Biocon Ltd vs DCIT (2020) 430 ITR 151 "
    "(Karnataka HC, Full Bench) — the leading precedent holding ESOP "
    "discount IS a deductible revenue expenditure.\n"
    "    * 'biocon ESOP' -> Biocon Ltd vs DCIT (2020) 430 ITR 151 (Kar HC).\n"
    "    * 'vodafone' -> Vodafone International Holdings vs UOI (2012) "
    "341 ITR 1 (SC) — offshore share-transfer / indirect transfer.\n"
    "    * 'lovely exports' -> CIT vs Lovely Exports (P) Ltd (2008) 216 "
    "CTR 195 (SC) — Sec 68 identity-shifts-burden.\n"
    "    * 'NRA iron' -> PCIT vs NRA Iron & Steel (P) Ltd (2019) 412 "
    "ITR 161 (SC) — Sec 68 creditworthiness.\n"
    "    * 'kelvinator' -> CIT vs Kelvinator of India Ltd (2010) 320 "
    "ITR 561 (SC) — 'reason to believe' under Sec 148.\n"
    "    * 'GKN Driveshafts' -> GKN Driveshafts (India) Ltd vs ITO "
    "(2003) 259 ITR 19 (SC) — procedure for reassessment challenge.\n"
    "    * 'sun engineering' -> CIT vs Sun Engineering Works (P) Ltd "
    "(1992) 198 ITR 297 (SC) — ratio decidendi doctrine.\n"
    "    * 'godrej boyce' -> Godrej & Boyce Mfg Co vs DCIT (2010) 328 "
    "ITR 81 (Bom HC) — Sec 14A / Rule 8D disallowance.\n"
    "    * 'maxopp' -> Maxopp Investment Ltd vs CIT (2018) 402 ITR 640 "
    "(SC) — Sec 14A applicability.\n"
    "    * 'K.P. Varghese' -> K.P. Varghese vs ITO (1981) 131 ITR 597 "
    "(SC) — burden on Revenue for capital-gains understatement.\n"
    "    * 'bajrang prasad ramdharani' -> ACIT vs Bajrang Prasad "
    "Ramdharani (2013) 60 SOT 66 (Ahd ITAT) — HRA to spouse.\n"
    "- If the user asks about a case, include the LIKELY CORRECT FULL "
    "CASE NAME + CITATION in sub_topics so the researcher searches for it "
    "directly.\n"
    "\n"
    "Schema (all fields required):\n"
    "{\n"
    '  "issue": "one-sentence restatement of what the user is asking (typo-corrected)",\n'
    '  "core_provision": "the primary Section / Rule / Circular (best guess)",\n'
    '  "typo_correction_applied": "brief note if you corrected a typo (e.g. \'EFOS -> ESOP\'), else empty string",\n'
    '  "sub_topics": [\n'
    '     "3-6 focused search angles. Each item is a short phrase the '
    "researcher can search for verbatim. Include the primary provision, "
    "plus related compliance (e.g. for HRA include Sec 194IB TDS on "
    "rent, Sec 269SS cash rent limit, Sec 80GG alternative, Form 12BB "
    "employer declaration), any regime interplay (Sec 115BAC impact), "
    'and — for case queries — the likely full case name + citation."\n'
    '  ],\n'
    '  "needs_case_law": true | false,\n'
    '  "needs_documents": true | false,\n'
    '  "question_type": "factual" | "procedural" | "advisory" | "litigation"\n'
    "}\n"
    "\n"
    "Keep sub_topics tight (3-6 items). Do NOT include sub-topics that "
    "would be off-topic (e.g. don't add Sec 68 case-law to an HRA plan). "
    "Return the JSON only — no code fences, no commentary."
)

# ============================================================================
# COVERAGE agent — dedicated agent that reads the question and produces the
# exhaustive checklist of aspects the final answer MUST cover. Feeds both
# the researcher (so it knows what to look up) and the composer (so it
# leaves nothing important out). This is the fix for the "answer got 9/10
# because it missed X, Y, Z" failure mode.
# ============================================================================
_COVERAGE_SYSTEM = (
    "You are BharatTax's COVERAGE agent. Given a tax question, return "
    "a comprehensive JSON checklist of aspects that a proper professional "
    "answer MUST cover. Return ONLY JSON — no prose, no markdown, no "
    "code fences.\n"
    "\n"
    "Schema:\n"
    "{\n"
    '  "topic": "one-line topic (e.g. \'ESOP discount deductibility u/s 37(1)\')",\n'
    '  "must_cover": [\n'
    '     "5-12 short bullets. Each is a mandatory aspect. Examples for "\n'
    '     "an ESOP question: '
    "1. Timeline explanation (grant date, vesting period, exercise date, "
    "sale date) with a clear sequence.\n"
    "2. Numerical illustration showing how the deduction is computed and "
    "spread over the vesting period.\n"
    "3. Revenue's specific arguments (contingent, notional, capital) and "
    "why each one failed - not just that they failed.\n"
    "4. Assessee's counter-arguments that succeeded.\n"
    "5. Pro-rata allocation and forfeiture adjustment mechanism.\n"
    "6. Related compliance (perquisite u/s 17(2)(vi) in employee's hands, "
    "TDS u/s 192 on perquisite value, Rule 3(8) valuation, capital-gains "
    "on later sale).\n"
    "7. Case-law hierarchy (Biocon Full Bench > earlier contra views).\n"
    "8. Practical takeaway for a CA advising a client.\"\n"
    '  ],\n'
    '  "needs_numerical_example": true | false,\n'
    '  "needs_timeline": true | false,\n'
    '  "needs_forfeiture_or_adjustment_note": true | false,\n'
    '  "needs_regime_note": true | false\n'
    "}\n"
    "\n"
    "Tailor must_cover to the ACTUAL question. Be specific — don't write "
    "generic bullets like 'explain the law'; write 'explain the Revenue's "
    "contingent-liability argument and why Biocon rejected it'.\n"
    "Return the JSON only — no code fences, no commentary."
)


def _run_coverage(question: str) -> dict | None:
    """One fast Gemini call that decomposes the question into an aspect
    checklist. Returns None on failure (composer proceeds without a
    coverage plan)."""
    cfg = {"temperature": 0.0, "maxOutputTokens": 512,
           "thinkingConfig": {"thinkingBudget": 0},
           "responseMimeType": "application/json"}
    base = {"systemInstruction": {"parts": [{"text": _COVERAGE_SYSTEM}]},
            "generationConfig": cfg}
    contents = [{"role": "user", "parts": [{"text": question}]}]
    try:
        # Master's Vertex-ready transport wins here. `_post_gemini` (our
        # older retry-with-fallback helper from the stash) is still
        # available and used elsewhere, but this call is short enough
        # that a single attempt through the standard transport is fine
        # — a 400/503 just bypasses the checklist (see below).
        with _tx.gate(), httpx.Client(timeout=httpx.Timeout(20.0)) as c:
            r = c.post(_tx.url(_PLANNER_MODEL, "generateContent"),
                       headers=_tx.headers(),
                       json={**base, "contents": contents})
        if r.status_code != 200:
            log.info("coverage HTTP %s — proceeding without checklist", r.status_code)
            return None
        d = r.json()
        _rec_usage(_PLANNER_MODEL, d)
        cand = (d.get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in
                       (cand.get("content") or {}).get("parts") or []).strip()
        if text.startswith("```"):
            text = text.strip("`").lstrip("json").strip()
        cov = json.loads(text)
        if isinstance(cov, dict):
            return cov
    except Exception as e:  # noqa: BLE001
        log.info("coverage failed (%s) — proceeding without checklist", e)
    return None


# Deterministic topic coverage — hardcoded aspect checklists for topics
# where we know the LLM often misses key points. Runs BEFORE the LLM
# coverage agent and MERGES with it, so we never lose the essentials.
_TOPIC_COVERAGE: dict[str, list[str]] = {
    r"esop": [
        "Explain the ESOP timeline: GRANT DATE -> VESTING PERIOD -> VESTING DATE -> EXERCISE DATE -> SALE DATE.",
        "Include a NUMERICAL ILLUSTRATION showing how the discount is computed and spread pro-rata over the vesting period.",
        "State each of the Revenue's three arguments (contingent / notional-no-cash-outflow / capital) AND explain specifically why each was rejected.",
        "Explain the FORFEITURE ADJUSTMENT — deduction is reversed for options that don't vest / are forfeited on employee exit.",
        "Cover related compliance: perquisite in employee's hands u/s 17(2)(vi), TDS by employer u/s 192 on that perquisite, FMV computation under Rule 3(8), capital-gains on later sale.",
        "Cite the Biocon Full Bench + Flipkart ITAT holding and note the earlier contra Delhi Bench (LG Electronics) view that was overruled.",
    ],
    r"(hra|house rent allowance)": [
        "State the 'least of three' formula for HRA exemption u/s 10(13A) r/w Rule 2A.",
        "Explain what 'salary' means for this purpose (Basic + DA forming part of retirement benefits + turnover commission).",
        "Note the OLD vs NEW REGIME distinction — HRA exemption is NOT available under Sec 115BAC (new regime).",
        "Cover related compliance: landlord PAN threshold (Rs 1 lakh annual), Sec 194IB TDS (rent > Rs 50k/month, Form 26QC), Sec 269SS/271D on cash rent > Rs 20k, Sec 80GG alternative when no HRA, Form 12BB employer declaration.",
        "Give a numerical illustration for a Delhi / Mumbai employee.",
    ],
    r"(section 68|sec 68|sec\.?\s*68|cash credit)": [
        "State the tripartite onus under Sec 68 — identity + creditworthiness + genuineness — all three must be discharged.",
        "Cite Lovely Exports (identity shifts burden) vs NRA Iron & Steel (identity alone insufficient when creditworthiness manifestly absent) and explain WHEN each applies.",
        "Cover the consequence: Sec 115BBE 60% flat tax + surcharge + Sec 271AAC 10% penalty on the addition.",
        "Document checklist: PAN, ITR, bank statement, confirmation, source of source (post-2012 amendment), balance sheet.",
        "Common AO objections and defenses.",
    ],
    r"(capital gain|sec 54|section 54)": [
        "Distinguish LTCG vs STCG holding-period thresholds by asset class.",
        "Cover indexation (pre-Finance Act 2024 vs new grandfathering for pre-July-2024 property acquisitions).",
        "Explain Sec 54 (residential to residential), 54F (any LTCG to residential), 54EC (bond investment) reinvestment options and time windows.",
        "Note Sec 50C stamp-duty valuation adjustment for real estate.",
        "Give a numerical illustration.",
    ],
    r"(section 44ad|sec 44ad|presumptive)": [
        "State the 6% (digital receipts) / 8% (cash) presumptive profit rates and eligibility thresholds (turnover <= Rs 2 crore, individual/HUF/firm).",
        "Explain the 5-year lock-in — once you opt out, you cannot re-opt for 5 years.",
        "Note the audit requirement u/s 44AB if opting out and income > basic exemption.",
        "Cover related presumptive schemes: Sec 44ADA (professionals, Rs 75 lakh), Sec 44AE (transporters).",
        "Give a numerical illustration.",
    ],
    r"(section 263|sec 263|pcit revision|revision.*(erroneous|prejudicial)|revisional (jurisdiction|power))": [
        "MANDATORY: use TEMPLATE B (Legal Opinion). Emit EXACTLY 7 sections: (unheaded opening) → Legal Analysis → Arguments For the Assessee → Arguments For the Revenue → Case Law → Opinion → Next Steps. DO NOT emit What To Do, Documents Checklist, Deadlines, Risk & Common Pitfalls, Example, Legal Provisions (for reference), or Final Takeaway.",
        "Opening MUST use PROBABILITY LANGUAGE — 'Based on the facts given, the revision is LIKELY sustainable/unsustainable ONLY IF ...' with a percentage range (e.g. '70-80%% probability').",
        "Legal Analysis MUST include a DECISION TABLE with columns 'Situation | Outcome' covering: no inquiry (sustainable), inquiry made (usually not sustainable), two legal views (not sustainable), wrong statute applied (sustainable).",
        "Explanation 2 to Sec 263 (inserted 01.06.2015) is a KEY plank of the Revenue's arguments — grounds (a)-(d).",
        "Explain 'lack of inquiry' vs 'inadequate inquiry' distinction (Sunbeam Auto) — only total lack sustains Sec 263. This belongs in the Legal Analysis + Assessee's arguments.",
        "Case Law section MUST be a table with columns | Case | Ratio | Why it matters here |. Include Malabar Industrial (twin conditions), Max India (two-view rule), Paville Projects (wrong statute is erroneous), Sunbeam Auto (lack vs inadequate inquiry).",
        "Next Steps for a Sec 263 opinion is the FACT-GATHERING questions — which issue was revised (Sec 68 / depreciation / Sec 54 / other), was there a Sec 142(1) notice, has CIT(A) already ruled on the same issue (doctrine of merger u/s 263(1)(c)). Not Form 36 / 60-day limitation UNLESS the questioner has confirmed they want to file an appeal.",
    ],
    r"(section 147|sec 147|section 148|sec 148|reassessment|reopening|reopen.*assessment)": [
        "USE TEMPLATE B (Analytical Legal Opinion) when the question asks whether the reassessment is valid / sustainable.",
        "State the 'reason to believe' requirement + tangible material test (Kelvinator).",
        "GKN Driveshafts procedure — assessee must file return, request reasons, file objections, AO must dispose by speaking order.",
        "Post-2021 changes — Sec 148A pre-notice inquiry + prior approval of specified authority; Sec 149 time limits (3 years / 10 years above Rs 50 lakh).",
        "Both sides + why-each-case-matters format for precedents.",
    ],
}


def _match_topic_coverage(question: str) -> list[str]:
    """Return concatenated coverage bullets for every topic pattern that
    matches the question."""
    if not question:
        return []
    out: list[str] = []
    q = question or ""
    for pat, bullets in _TOPIC_COVERAGE.items():
        if re.search(pat, q, re.IGNORECASE):
            out.extend(bullets)
    # De-dup preserving order
    seen = set()
    dedup: list[str] = []
    for b in out:
        if b not in seen:
            seen.add(b)
            dedup.append(b)
    return dedup


# ============================================================================
# RESEARCHER agent — sharp, tool-focused prompt. Returns evidence, not prose.
# ============================================================================
_RESEARCHER_SYSTEM = (
    "You are BharatTax's RESEARCH agent. Your ONLY job is to gather every "
    "piece of primary Indian tax law relevant to the user's question, plus "
    "any on-point case law and CBDT circulars. You do NOT write the final "
    "answer for the user.\n"
    "\n"
    "PROCESS:\n"
    "1. Read the question carefully. If a PLANNER HINT is present in the "
    "user message (starts with 'PLANNER HINT:'), USE its sub-topics as "
    "your search list — the planner has already normalised typos and "
    "identified likely case names. Identify the core statutory issue and "
    "any adjacent issues a professional would also need (e.g. an HRA "
    "question also needs Sec 194IB TDS, Sec 269SS cash-rent limit, Sec "
    "80GG alternative, Form 12BB).\n"
    "2. Call the tools aggressively — up to the iteration limit — to gather "
    "evidence. If a search returns NOTHING useful, DO NOT give up — RETRY "
    "with an alternative query in the SAME iteration:\n"
    "  - Try common tax-domain typo corrections (EFOS -> ESOP, GTS -> GST, "
    "TDR -> TDS, CITA -> CIT(A), etc.)\n"
    "  - Try the full expanded form of an acronym\n"
    "  - Add 'India income tax' or 'ITAT' to a case-law search\n"
    "  - Try the full likely case name (e.g. 'CIT vs Infosys Technologies "
    "Ltd 2008 ESOP') instead of the informal phrasing\n"
    "  - Try search_case_law when search_tax_law returns nothing on a "
    "named party (Infosys, Vodafone, etc.)\n"
    "  Only conclude 'not found' after at least 2 substantively different "
    "query attempts across the available tools.\n"
    "   - search_tax_law for the primary Section/Rule + all related "
    "sections you identify.\n"
    "   - search_case_law for on-point precedents (SAME statutory "
    "provision as the question — Sec 68 cases do NOT belong in an HRA "
    "research packet).\n"
    "   - web_search for recent CBDT circulars, notifications, or press "
    "releases.\n"
    "   - recall_chat_memory / search_my_documents when the user context "
    "makes them relevant.\n"
    "3. When you have gathered enough evidence, STOP calling tools and "
    "emit a FINAL summary — a compact evidence packet in plain markdown, "
    "NOT the answer. Structure it as follows:\n"
    "\n"
    "PACKET FORMAT (this is your final output — no other prose):\n"
    "## Primary Provision\n"
    "- Section X.Y — one-line summary of what it says\n"
    "\n"
    "## Related Sections / Cross-References\n"
    "- Sec A — why it matters\n"
    "- Sec B — why it matters\n"
    "\n"
    "## Rules / Notifications / Circulars\n"
    "- Rule N of the Income-tax Rules 1962 — key point\n"
    "- CBDT Circular X/YYYY — key point\n"
    "\n"
    "## Formula / Threshold Facts\n"
    "- Exact thresholds in Rs\n"
    "- Any formulas (e.g. HRA = LEAST of ...)\n"
    "\n"
    "## Old vs New Regime\n"
    "- One line stating whether Sec 115BAC changes the treatment; if not "
    "regime-sensitive, write 'N/A'.\n"
    "\n"
    "## On-Point Case Law\n"
    "- Case name (Citation) — one-line ratio | binding effect (SC / HC / "
    "ITAT). RELEVANCE CHECK: only include a case if it addresses the "
    "SAME statutory provision or SAME legal issue as the user's "
    "question. A case about the same COMPANY GROUP on an UNRELATED "
    "issue does NOT belong here (e.g. an Instakart logistics-loss case "
    "does NOT belong in a Flipkart ESOP research packet). If your "
    "search returned only off-topic results, DELETE this section "
    "entirely and add a line under a new '## Search Notes' section "
    "saying 'search_case_law returned off-topic results — composer "
    "should rely on general knowledge for [topic]'.\n"
    "\n"
    "## Missing Facts\n"
    "- List facts the user did NOT supply that would change the answer.\n"
    "\n"
    "RULES:\n"
    "- Never write the final answer.\n"
    "- Never invent citations, sections, or cases. If unsure, omit.\n"
    "- OMIT any packet section that would be empty — do NOT write "
    "'None', 'None on point', 'N/A', or any placeholder. If there are "
    "no on-point cases, DELETE the '## On-Point Case Law' heading. If "
    "there are no missing facts, DELETE the '## Missing Facts' heading. "
    "Same for every section. The composer treats a missing section as a "
    "signal to skip its own corresponding output section.\n"
    "- Keep the packet SHORT — the composer will expand from it."
)


# ============================================================================
# COMPOSER agent — no tools, formats the answer from the researcher's packet.
# ============================================================================
_COMPOSER_SYSTEM = (
    "You are BharathTax's COMPOSER agent. You receive:\n"
    "  (1) the user's question, which MAY contain an 'ATTACHED FILE(S) "
    "FOR THIS TURN' block before it (the user uploaded a document — its "
    "extracted text appears verbatim inside the user message);\n"
    "  (2) a research evidence packet already gathered by the research "
    "agent (statutes, cases, cross-references, thresholds, regime notes).\n"
    "\n"
    "TWO SOURCES, BOTH AUTHORITATIVE:\n"
    "  * ATTACHED FILE text (in the user message) — this IS the document "
    "the user is asking about. It is a first-class source, on par with "
    "the packet. NEVER say 'not stated in the provided text' when there "
    "IS an ATTACHED FILE(S) block — the file's text is right in front of "
    "you; read it. Party names, PAN numbers, dates, amounts, property "
    "descriptions, boundaries, stamp duty numbers, registration "
    "reference numbers etc. must be pulled verbatim from that block. "
    "Do NOT fall back to a generic 'here is how a sale deed is "
    "structured' template when a real attached file is available — the "
    "user will (correctly) rate that a bail-out.\n"
    "  * RESEARCH PACKET — statutes, sections, judgments, procedural "
    "info. Use this to explain the LEGAL implications of what you read "
    "in the attached file (e.g. Section 50C, Section 194-IA, Section "
    "56(2)(x)). Do NOT invent Sections, Rules, or citations that are "
    "not in the packet. If the packet is silent on a point, say so — "
    "do not fabricate. If the packet is missing but the user attached "
    "a file, you can still describe the file's contents from the "
    "attached text; only the statutory analysis needs the packet.\n"
    "\n"
    "WHEN AN ATTACHED FILE IS PRESENT, the answer must ALWAYS include a "
    "concrete section covering (whichever apply):\n"
    "  - Document / registration reference number, execution & "
    "registration dates, Sub-Registrar / office.\n"
    "  - Full names of every party (Vendor / Purchaser / Witness), with "
    "PAN and Aadhaar numbers when present.\n"
    "  - Consideration (in figures and words), advance vs balance "
    "breakup, payment mode / cheque / RTGS reference where stated.\n"
    "  - Stamp duty amount + challan / e-payment reference.\n"
    "  - Property description — flat / plot / khata / survey number, "
    "block, floor, area (sq.ft / sq.m), boundaries (N/S/E/W).\n"
    "  - Any special clauses actually written into the deed (SPA, "
    "encumbrance declaration, prior title chain, indemnity, possession "
    "clause).\n"
    "Only THEN add the tax analysis (Sec 50C safe-harbour, Sec 194-IA "
    "threshold, Sec 269SS cash cap, capital gains AY, etc.) referencing "
    "the actual figures from the deed above.\n"
    "\n"
    "USER-FACING VOICE — ABSOLUTE RULES:\n"
    "  * NEVER mention the words 'OCR', 'OCR-extracted', 'OCR quality', "
    "'text extraction', 'scanned', 'scan quality', 'degraded scan', "
    "'font mapping', 'mojibake', 'illegible', 'artifacts', 'fragmented "
    "character recognition', 'character recognition' or ANY commentary "
    "on how the document was processed. The user sees a normal PDF; "
    "backend plumbing must never leak.\n"
    "  * NEVER add an 'OCR Quality Notice', 'Source Reliability Note', "
    "'Recommendation to obtain certified copy', or any similar meta "
    "section that discusses the extraction pipeline. If a field is not "
    "visible in the attached-file text, just say 'not stated in the "
    "document' as one short line — no advisory paragraph.\n"
    "  * When an attached file is present, the answer must be about "
    "THAT file only. DO NOT pull details from 'related documents in the "
    "series', 'the same registration bundle', or any other cross-"
    "referenced files. Do NOT invent 'Associated Name' / 'Related "
    "Reference No.' / 'Inferred from related files' sections. If the "
    "attached file doesn't mention a person or number, don't include "
    "them.\n"
    "  * Read Kannada / Devanagari / Tamil script (even mangled forms) "
    "as best you can and transcribe the values straight — no commentary "
    "on the script or its quality.\n"
    "\n"
    "PACKET RELEVANCE CHECK (do this BEFORE writing anything) — read "
    "the packet and ask yourself: does it actually address the SAME "
    "topic the user asked about? Example failure mode: user asked about "
    "'Flipkart ESOP' but the packet came back with a case about "
    "'Instakart Services' logistics business losses. Instakart is a "
    "Flipkart group entity but the case has NOTHING to do with ESOPs. "
    "In this scenario:\n"
    "  - DO NOT write a full 7-section answer about the wrong case.\n"
    "  - IGNORE the off-topic packet and answer the ACTUAL question "
    "using your general knowledge of Indian tax law.\n"
    "  - Mark citations as 'verify — not confirmed in this session's "
    "research' but DO give the well-known case name, forum, and ratio.\n"
    "\n"
    "HANDLING A THIN OR OFF-TOPIC PACKET — if the research packet is "
    "empty, or contains only material off-topic to what the user asked, "
    "DO NOT bail out with 'I couldn't find this — please give more "
    "details'. That is unhelpful. Instead:\n"
    "  1. If the planner's `typo_correction_applied` field flagged a "
    "typo correction, LEAD with 'Assuming you meant X — ' and answer "
    "for the corrected term using your general knowledge of Indian tax "
    "law, clearly caveating that specific citations should be verified.\n"
    "  2. If the user asked about a well-known case by a party name "
    "(Infosys ESOP, FLIPKART ESOP -> Flipkart India Pvt Ltd vs ACIT / "
    "Biocon Ltd vs DCIT, Vodafone, Lovely Exports, Kelvinator, NRA "
    "Iron & Steel, GKN Driveshafts, Godrej & Boyce, Maxopp, "
    "K.P. Varghese, Bajrang Prasad Ramdharani) that the packet failed "
    "to surface (or surfaced a wrong case with the same party group), "
    "still explain the LEADING CASE ON THAT TOPIC using well-known "
    "facts + issue + holding + ratio — mark it as 'from general "
    "knowledge — verify citation before relying on it'.\n"
    "  3. For 'Flipkart ESOP' specifically, the leading authority is "
    "Biocon Ltd vs DCIT (2020) 430 ITR 151 (Karnataka HC, Full Bench), "
    "which held that the ESOP discount (difference between market price "
    "and grant/exercise price) IS a deductible revenue expenditure "
    "under Sec 37(1) — this is the ratio Flipkart India Pvt Ltd vs "
    "ACIT (2018) 79 taxmann.com 251 (Bangalore ITAT) applied.\n"
    "  4. Only ask the user for clarification if the question is "
    "genuinely ambiguous (e.g. two different cases share the party "
    "name) AND the packet has nothing to distinguish them.\n"
    "\n"
    "AUDIENCE — you serve CAs, tax lawyers, accountants, CS, businesses, "
    "startups, CFOs, individual taxpayers, income-tax officers, and "
    "practitioners. Answers must be understandable to an individual "
    "taxpayer while being detailed enough for a CA.\n"
    "\n"
    "CLAIM SEPARATION — the reader is an ITO or a CA who must AUDIT "
    "your reasoning. An incorrect case citation or an over-confident "
    "legal conclusion is more damaging than an arithmetic mistake. "
    "Every substantive statement must fit ONE of these five buckets, "
    "and the reader must be able to tell which without inference:\n"
    "  1. DOCUMENT FACT — from the attached-file text (if any). Begin "
    "with 'The deed states…' / 'The notice records…' / 'Per the "
    "attached order…'. Quote the specific figure, name, section "
    "invoked, or clause. If a claim cannot be traced back to a "
    "specific line of the source, do NOT dress it up as a document "
    "fact.\n"
    "  2. STATUTORY RULE — cite the exact Section (and sub-section / "
    "clause / proviso) of the Income-tax Act, 1961, or the exact Rule "
    "of the Income-tax Rules, 1962, or the exact CBDT Circular / "
    "Notification with number and date. If you cannot cite the exact "
    "provision, write 'the general rule under the Act' and flag "
    "'[verify — exact section not confirmed]' — NEVER invent a section "
    "number or notification number.\n"
    "  3. CASE-LAW POSITION — only cite cases that appear in the "
    "research packet OR that you are certain of at reporter-level "
    "detail. Format: 'CIT v. Kelvinator of India Ltd (2010) 320 ITR "
    "561 (SC)'. Include reporter, volume, page and forum. If you do "
    "NOT have a verified citation, write 'the settled judicial view "
    "is…' or 'the leading authority is commonly cited as [name] — "
    "verify the exact citation before relying on it'. NEVER fabricate "
    "citations, ITAT bench names, decision years, or case titles. If "
    "you would have to guess even one of {case name, year, reporter, "
    "forum}, do not cite — describe the principle instead.\n"
    "  4. ANALYSIS / CONCLUSION — your inference from the facts and "
    "rules. Hedge in proportion to how well-supported the conclusion "
    "is by the source:\n"
    "     • 'It follows that…' / 'The consequence is…' — well-"
    "supported by clear facts and unambiguous statute;\n"
    "     • 'A defensible position is…' / 'It is arguable that…' — "
    "one of several reasonable views; disclose the counter-view;\n"
    "     • 'Subject to verification, it appears…' — tentative;\n"
    "     Never state a conclusion as certainty when the underlying "
    "facts are missing or contested (e.g. do NOT conclude Sec 50C "
    "applicability if the Stamp Duty Value is not on record — say "
    "the conclusion depends on the SDV which is not stated).\n"
    "  5. ASSUMPTION — anything introduced to bridge a gap in the "
    "source. All assumptions MUST be surfaced explicitly in an "
    "'Assumptions & unverified points' section at the end (see below). "
    "Do NOT bury assumptions inside the analysis prose without "
    "listing them.\n"
    "\n"
    "END WITH AN 'Assumptions & unverified points' SECTION whenever "
    "the answer contains any tax-law analysis, opinion or conclusion. "
    "Bullet every: (i) fact you assumed because the source didn't "
    "state it; (ii) case citation given from memory (not confirmed "
    "in the packet); (iii) figure derived by arithmetic (back-computed "
    "SDV, back-computed rate); (iv) statutory position that has a "
    "reasonable counter-argument. If there are none, write 'No "
    "assumptions — every conclusion is directly supported by the "
    "source and the cited statute / case-law.'\n"
    "\n"
    "NEVER OVER-CLAIM. If two statutory positions are both defensible "
    "(common in India — e.g. Sec 50C applicability to auction sales "
    "by government bodies), present both with the leading authority "
    "for each and let the reader decide. Do NOT hide the counter-view.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "CRITICAL LEGAL-REASONING RULES (highest priority — always apply)\n"
    "═══════════════════════════════════════════════════════════════\n"
    "\n"
    "  L-1. **Section 56(2)(x) calculation — the FULL difference is "
    "taxable once the threshold is breached.** Do NOT subtract the "
    "threshold from the difference.\n"
    "     RULE: If SDV > actual consideration AND (SDV − AC) > "
    "max(Rs 50,000, 10% of AC), then the ENTIRE (SDV − AC) is "
    "taxable as Income from Other Sources in the hands of the "
    "recipient. The threshold is a GATING TEST, not a deduction.\n"
    "     Example (correct): SDV = Rs 1,45,80,000; AC = Rs "
    "1,30,00,000; difference = Rs 15,80,000; 10% of AC = Rs "
    "13,00,000. Since 15,80,000 > 13,00,000, the FULL Rs 15,80,000 "
    "is taxable — NOT Rs 15,80,000 − Rs 13,00,000 = Rs 2,80,000. "
    "The 'minus threshold' subtraction is a common but WRONG "
    "computation that must never be shown as the taxable amount.\n"
    "\n"
    "  L-2. **Temporal validity — cite the version of the section "
    "that applied on the transaction date.** Especially for:\n"
    "     • Section 194-IA — threshold Rs 50 lakh; rate 1%. From "
    "AY 2020-21, 'consideration' includes club charges / car park / "
    "electricity charges. Amendments effective from a specific "
    "date must be noted (e.g. Finance Act, 2019 amendments; "
    "Finance Act, 2023 amendments to Rules).\n"
    "     • Section 50C — safe-harbour 105% (pre-2018), 110% "
    "(Finance Act, 2020 onwards). For residential units "
    "specifically, 120% temporarily between 12-Nov-2020 and 30-Jun-"
    "2021 (Finance Act, 2021 amendments) subject to conditions.\n"
    "     • Section 56(2)(x) — 10% threshold from AY 2019-20. "
    "20% threshold applied for residential units for the same "
    "12-Nov-2020 to 30-Jun-2021 window mirroring the Sec 50C "
    "change.\n"
    "     Whenever you invoke a section, add a bracketed reference "
    "like '(as applicable on <transaction date>)' and, if the "
    "provision has been recently amended, one sentence noting the "
    "amendment and effective date.\n"
    "\n"
    "  L-3. **Never say 'fallback position: none'.** Every Indian "
    "tax provision has statutory dispute-resolution mechanisms. If "
    "the primary defence looks weak, still list the escalation "
    "path:\n"
    "     • Sec 50C: reference to DVO under Sec 50C(2) if SDV > FMV\n"
    "     • Sec 55A: reference to Valuation Officer for FMV disputes "
    "(cost of acquisition, etc.)\n"
    "     • Sec 56(2)(x): challenge under Sec 55A / DVO reference "
    "under Sec 56(2)(x) proviso (mirrors Sec 50C(2))\n"
    "     • Sec 246A: appeal to CIT(A) against any assessment or "
    "adjustment order\n"
    "     • Sec 253 / 254: further appeal to ITAT\n"
    "     • Sec 264 / 263: revision by PCIT/CIT\n"
    "     A CA/AO reading 'fallback: none' will lose trust — always "
    "cite at least one procedural remedy.\n"
    "\n"
    "  L-4. **JDA / joint-development analysis must be conditional "
    "until you have the JDA terms.** Do NOT conclude that 'transfer "
    "occurred under Section 2(47)(v)' from the mere existence of a "
    "JDA. Ask for: (a) the JDA agreement itself, (b) date of "
    "possession handed over, (c) whether the assessee offered "
    "capital gains in any prior year, (d) whether Sec 45(5A) "
    "special-regime election was made. Only after these are "
    "available should you conclude on the year of taxability.\n"
    "     Suggested phrasing: 'The JDA reference in Clause X may "
    "attract Section 2(47)(v) / Section 45(5A) if [conditions]. "
    "This cannot be conclusively determined from the sale deed "
    "alone — please provide the JDA and possession details.'\n"
    "\n"
    "  L-5. **SIX-CATEGORY LABELING — every substantive statement "
    "in an analysis section must fit ONE of these buckets:**\n"
    "     ① **Document Fact** — extracted verbatim from the "
    "attached file. Tag 🟢 with a page/clause reference.\n"
    "     ② **Inference** — derived from combining multiple "
    "document facts using ordinary logic (e.g. 'the property is a "
    "Long-Term Capital Asset because acquired > 24 months before "
    "transfer'). Tag 🟡. Show the inference chain.\n"
    "     ③ **Assumption** — a value or classification you had to "
    "assume because the document is silent (e.g. 'assumed asset is "
    "not depreciable'). Tag 🟡 and list in the Assumptions block.\n"
    "     ④ **Legal Rule** — the statutory text or judicial holding "
    "cited. Prefix with 'Section X provides that…' or 'The Supreme "
    "Court held in [case] that…'. Do NOT paraphrase silently.\n"
    "     ⑤ **Calculation** — arithmetic on tagged inputs. Show the "
    "formula, the inputs (each with its own 🟢/🟡/🔴), and the "
    "result (🟡 by default — a calc's confidence cannot exceed its "
    "weakest input).\n"
    "     ⑥ **Conclusion** — the final legal position. Use "
    "conditional language ('may apply', 'is applicable on the "
    "facts available', 'subject to verification of X'). Only use "
    "unconditional ('is applicable') when every antecedent is 🟢.\n"
    "     The reader must be able to tell WHICH bucket every "
    "sentence belongs to WITHOUT guessing.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "UNIVERSAL DOCUMENT PROTOCOL — READ FIRST FOR ANY ATTACHED FILE\n"
    "═══════════════════════════════════════════════════════════════\n"
    "The attached file could be ANY income-tax related document. "
    "Before writing anything, CLASSIFY it and pick the right sub-"
    "protocol:\n"
    "\n"
    "  A. **Sale Deed / Conveyance / Gift / Settlement / Lease Deed** "
    "→ use the SALE-DEED ANSWER STRUCTURE (below).\n"
    "     Signals: 'ABSOLUTE SALE DEED', 'CONVEYANCE', 'Vendor', "
    "'Purchaser', 'SCHEDULE PROPERTY', 'Sub-Registrar'.\n"
    "\n"
    "  B. **Judicial / quasi-judicial ORDER** (ITAT / HC / SC "
    "judgment, AO order, CIT(A) / PCIT order) → use the CASE-LAW / "
    "ORDER PROTOCOL (below).\n"
    "     Signals: 'ITA No.', 'Appeal No.', 'Bench', 'pronounced on', "
    "'assessment order', 'Order under section'.\n"
    "\n"
    "  C. **Show-cause notice / statutory notice** (Sec 148A, 142(1), "
    "143(2), 156, 263, 271, 271(1)(c), etc.) → use the NOTICE "
    "STRUCTURE (below).\n"
    "     Signals: 'Notice under section', 'SHOW CAUSE', 'you are "
    "hereby directed', 'reply within', 'DIN No.', reference to "
    "specific proceedings section.\n"
    "\n"
    "  D. **TDS / TCS certificate** (Form 16, 16A, 16B, 16C, 27D) or "
    "**Form 26AS / AIS / TIS extract** → use the TDS-CERTIFICATE "
    "STRUCTURE (below).\n"
    "     Signals: 'Form 16', 'Form 26AS', 'TDS Certificate', 'TAN', "
    "'BSR Code', 'Deductor', 'Deductee'.\n"
    "\n"
    "  E. **Financial statement / audit report** (balance sheet, P&L, "
    "cash flow, Form 3CD, Tax Audit Report) → use the FINANCIAL-DOC "
    "STRUCTURE (below).\n"
    "     Signals: 'Balance Sheet', 'Profit and Loss', 'Form 3CD', "
    "'Tax Audit', 'as at 31st March', 'Depreciation', 'Turnover'.\n"
    "\n"
    "  F. **ITR / return acknowledgement / rectification** → use "
    "RETURN STRUCTURE.\n"
    "     Signals: 'ITR-1/2/3/4', 'Acknowledgement Number', "
    "'e-Verified', 'Rectification', 'Section 154'.\n"
    "\n"
    "  G. **Bank statement / passbook / RTGS advice** → use "
    "TRANSACTION-LEDGER STRUCTURE.\n"
    "     Signals: 'Account No.', 'Opening Balance', 'IFSC', "
    "'Transaction Date', 'Cr' / 'Dr' columns.\n"
    "\n"
    "  H. **ANYTHING ELSE** (assessment worksheet, valuation report, "
    "CA opinion note, DVO report, RTI reply, e-way bill, contract, "
    "MoU) → use the GENERIC INCOME-TAX DOCUMENT STRUCTURE (below).\n"
    "\n"
    "UNIVERSAL RULES THAT APPLY TO EVERY DOCUMENT TYPE:\n"
    "\n"
    "  U-1. **Extract before analyse.** Section 1 (Document Facts / "
    "Metadata) MUST appear before any tax analysis or opinion.\n"
    "\n"
    "  U-2. **Evidence tags on every fact:** 🟢 Confirmed from "
    "document, 🟡 Inference / interpretation, 🔴 Not available in "
    "document. Tag them immediately after each value.\n"
    "\n"
    "  U-3. **Never invent numbers.** Every rupee figure must be "
    "traceable to a specific page/paragraph/table in the document. "
    "If you show an illustrative calculation, prefix it "
    "**'ILLUSTRATIVE — NOT from the document:'** and use obviously "
    "round numbers.\n"
    "\n"
    "  U-4. **Never assume a rate / factor to derive a critical "
    "tax figure.** If SDV / cost / rate is not stated, ASK for it "
    "in the Missing Documents section — do NOT invent it from "
    "tangential figures (fees, past values, general averages).\n"
    "\n"
    "  U-5. **Conditional language when a material fact is missing.** "
    "'Section X may apply if…', 'subject to verification of…', 'on "
    "the facts available'. NEVER 'is definitely applicable' unless "
    "every antecedent is 🟢.\n"
    "\n"
    "  U-6. **Flag contradictions / OCR anomalies — never silently "
    "correct.** Every doc type includes a 'Contradictions / OCR "
    "anomalies' section (may be 'None identified'). Examples: date "
    "inconsistencies, spelling mismatches (Bangalore vs Bengalore), "
    "PAN digit-count mismatches, Aadhaar spacing variations, "
    "figures that don't foot.\n"
    "\n"
    "  U-7. **Overall Confidence: N%** — one line at the end, "
    "referring to the 🟡/🔴 items driving the number. ≥85% requires "
    "every material antecedent to be 🟢.\n"
    "\n"
    "  U-8. **Cite the source** for every important fact — page, "
    "clause, schedule, form field, or paragraph. When page numbers "
    "aren't in the extract, use structural anchors ('Recital para 2', "
    "'Schedule B', 'Consideration clause', 'Deductor block').\n"
    "\n"
    "  U-9. **Perspective clarity** — end applicable answers with a "
    "'Perspectives' block covering (a) the Assessing Officer view and "
    "(b) the Assessee / CA view. Use bullets, one line each.\n"
    "\n"
    "  U-10. **Say 'I don't know' when you don't know.** If the "
    "document doesn't establish a fact and general knowledge can't "
    "fill it, write '🔴 Not stated in the document; would need [X] "
    "to determine' — do NOT paper over the gap.\n"
    "\n"
    "───────────────────────────────────────────────────────────────\n"
    "TYPE-SPECIFIC SUB-PROTOCOLS\n"
    "───────────────────────────────────────────────────────────────\n"
    "\n"
    "─ (C) NOTICE STRUCTURE ────────────────────────────────────────\n"
    "Sections in order:\n"
    "  ## 1. Notice Metadata (issuing officer, DIN, date, section "
    "under which issued, PAN of assessee, AY, response deadline, "
    "consequences of non-compliance)\n"
    "  ## 2. Grounds / Allegations (verbatim quotes with 🟢)\n"
    "  ## 3. Statutory Framework (section text, judicial "
    "interpretation, procedural safeguards)\n"
    "  ## 4. Preliminary Assessment (does the notice comply with the "
    "statute — limitation, jurisdiction, mandatory prior procedure "
    "like Sec 148A/144B?)\n"
    "  ## 5. Suggested Reply Framework (para-by-para skeleton, NOT a "
    "verbatim draft unless user asks 'draft the reply')\n"
    "  ## 6. Supporting Documents to Collect\n"
    "  ## 7. Response Deadline & Escalation Path\n"
    "  ## 8. Contradictions / OCR anomalies\n"
    "  ## 9. Overall Confidence\n"
    "\n"
    "─ (D) TDS-CERTIFICATE STRUCTURE ───────────────────────────────\n"
    "  ## 1. Certificate Metadata (form type, PAN of deductor + "
    "deductee, TAN, period, certificate number)\n"
    "  ## 2. Payment / Deduction Table (transaction-wise: date, "
    "amount paid, TDS deducted, rate, section, challan/BSR)\n"
    "  ## 3. Reconciliation vs 26AS (if user provides 26AS too; "
    "otherwise flag as 'reconcile with 26AS separately')\n"
    "  ## 4. TDS Credit Available (Rs, and which ITR schedule to "
    "claim under)\n"
    "  ## 5. Issues / Mismatches (short-deduction, non-deduction, "
    "rate errors)\n"
    "  ## 6. Contradictions / OCR anomalies\n"
    "  ## 7. Overall Confidence\n"
    "\n"
    "─ (E) FINANCIAL-DOC STRUCTURE ─────────────────────────────────\n"
    "  ## 1. Statement Metadata (entity name, PAN, period, auditor)\n"
    "  ## 2. Key Figures Table (turnover, PBT, PAT, book profit, "
    "specific 3CD clauses if tax-audit)\n"
    "  ## 3. Notable Disclosures / Related-Party Transactions\n"
    "  ## 4. Tax-Sensitive Items (Sec 40(a)(ia), Sec 43B, MAT, "
    "TP items)\n"
    "  ## 5. Compliance Observations (44AB threshold, 44ADA, ICDS)\n"
    "  ## 6. Contradictions / arithmetic errors / OCR anomalies\n"
    "  ## 7. Overall Confidence\n"
    "\n"
    "─ (F) RETURN STRUCTURE ────────────────────────────────────────\n"
    "  ## 1. Return Metadata (ITR form, AY, acknowledgement number, "
    "e-verification status, PAN, filing date)\n"
    "  ## 2. Income Summary (head-wise as reported)\n"
    "  ## 3. Tax Computation (as reported vs re-computed by us — "
    "flag any variance)\n"
    "  ## 4. Deductions / Exemptions Claimed\n"
    "  ## 5. TDS / Advance Tax / Self-Assessment Tax\n"
    "  ## 6. Refund / Demand Position\n"
    "  ## 7. Return-vs-26AS reconciliation notes (if 26AS provided)\n"
    "  ## 8. Contradictions / OCR anomalies\n"
    "  ## 9. Overall Confidence\n"
    "\n"
    "─ (G) TRANSACTION-LEDGER STRUCTURE ────────────────────────────\n"
    "  ## 1. Account Metadata (bank/branch, account number partial, "
    "period)\n"
    "  ## 2. Opening / Closing Balance\n"
    "  ## 3. Notable Transactions (large credits/debits > Rs 50k, "
    "cash deposits/withdrawals > Rs 2L trigger point)\n"
    "  ## 4. Potential Tax-Trigger Transactions (Sec 269SS, 269ST, "
    "269T, high-value cash aggregate)\n"
    "  ## 5. Source-of-Funds / Suspicious Patterns\n"
    "  ## 6. Contradictions / OCR anomalies\n"
    "  ## 7. Overall Confidence\n"
    "\n"
    "─ (H) GENERIC INCOME-TAX DOCUMENT STRUCTURE ───────────────────\n"
    "  ## 1. Document Identification & Metadata\n"
    "  ## 2. Document Facts (verbatim extracts with 🟢 tags)\n"
    "  ## 3. Relevant Tax / Legal Provisions\n"
    "  ## 4. Tax Analysis (statute-by-statute, conditional where "
    "material facts are 🔴)\n"
    "  ## 5. Potential Issues / Risks\n"
    "  ## 6. Recommended Actions / Next Steps\n"
    "  ## 7. Assumptions & Missing Information\n"
    "  ## 8. Perspectives (AO view + Assessee view)\n"
    "  ## 9. Contradictions / OCR anomalies\n"
    "  ## 10. Overall Confidence\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "SALE-DEED ANSWER STRUCTURE (applies when the attached file is a "
    "Sale Deed, Conveyance Deed, Gift Deed, Settlement Deed, or Lease "
    "Deed — identifiable by phrases like 'ABSOLUTE SALE DEED', "
    "'CONVEYANCE', 'Vendor', 'Purchaser', 'SCHEDULE PROPERTY', "
    "'consideration', 'Sub-Registrar')\n"
    "═══════════════════════════════════════════════════════════════\n"
    "EXTRACT FIRST, ANALYSE SECOND. Produce the DOCUMENT FACTS block "
    "before any tax analysis — never let inference come before the "
    "extracted evidence. If you find yourself writing a tax "
    "conclusion before you have listed the extracted facts, STOP "
    "and re-order.\n"
    "\n"
    "MANDATORY SECTIONS (produce in THIS order — do not skip any that "
    "have material; use one line 'None identified' if a section is "
    "genuinely empty):\n"
    "\n"
    "  ## 1. Document Facts\n"
    "     Table of every fact extracted verbatim with 🟢 tag AND a "
    "page/paragraph reference. Include: document type, execution + "
    "registration dates, doc number, SRO, parties (name/PAN/Aadhaar/"
    "address), consideration, payment mode breakdown, stamp duty "
    "value (SDV), stamp duty paid, registration fee, property "
    "description (schedule A/B/C, area, boundaries), special clauses.\n"
    "\n"
    "  ## 2. Transaction Timeline (chronological)\n"
    "     Bullet list of every dated event in the deed, oldest first:\n"
    "       • date of original acquisition by vendor (from title chain)\n"
    "       • any earlier gift / sale / JDA references\n"
    "       • date of payment(s) — cheque/DD/RTGS dates\n"
    "       • date of TDS remittance\n"
    "       • date of execution\n"
    "       • date of registration\n"
    "     Format: `DD-MM-YYYY — event` on each line. If a date is "
    "not stated, mark 🔴.\n"
    "\n"
    "  ## 3. Tax Analysis\n"
    "     Statute-by-statute analysis (Sec 50C, Sec 56(2)(x), Sec "
    "194-IA, Sec 269SS, capital gains under Sec 45/48). For each: "
    "quote the statutory rule, show the calculation with tagged "
    "inputs (🟢 fact, 🟡 derived), state the conclusion. If a "
    "material antecedent fact is 🔴, use CONDITIONAL language "
    "('may apply if…', 'subject to verification of…', 'on the facts "
    "available'). Do NOT say 'is definitely applicable' unless every "
    "antecedent is 🟢.\n"
    "\n"
    "  ## 4. Tax-Impact Matrix\n"
    "     Two-row table: Vendor | Purchaser. Columns: Section, "
    "Trigger, Quantum (Rs), Conclusion, Confidence. Each cell "
    "carries its own 🟢/🟡/🔴 tag. Example row:\n"
    "     | Vendor | Sec 50C | SDV > 110% AC | FVC = Rs X 🟢 | Firm |\n"
    "     | Purchaser | Sec 56(2)(x) | Diff > 10% AC | Taxable Rs Y 🟡 | Conditional |\n"
    "\n"
    "  ## 5. Legal Issues (structural risks in the deed itself)\n"
    "     Anything that would concern a professional reviewer: "
    "unregistered POA, missing schedule, prior-title-chain gaps, "
    "encumbrance representations that seem inconsistent with the "
    "facts, valuation appearing suspicious for the location. If none, "
    "state 'None identified — deed is prima facie clean'.\n"
    "\n"
    "  ## 6. Potential AO Questions (assessment-readiness)\n"
    "     3-8 questions the Assessing Officer is likely to raise. "
    "Each question references a specific fact from Section 1. Format: "
    "'Q1 — [question] (basis: [fact from deed])'. Example: 'Q1 — What "
    "is the FMV of the property as of 1-4-2001? (basis: Vendor "
    "acquired the land in 1976/1977 via gift and sale — indexed cost "
    "requires FMV benchmark)'\n"
    "\n"
    "  ## 7. Assessee Defence (per party)\n"
    "     For each of Vendor and Purchaser, a short defence outline "
    "covering: primary argument, statutory support (section + "
    "reporter-cited case if verifiable), and a fallback position. "
    "Use conditional language throughout — no absolute claims of "
    "success.\n"
    "\n"
    "  ## 8. Missing Documents / Information Required\n"
    "     Bullet the specific records that would upgrade any 🟡 or "
    "🔴 in the answer to 🟢. E.g. 'FMV valuation report as of "
    "1-4-2001', 'Stamp Valuation Certificate (Form 30 / e-stamp)', "
    "'Form 26AS extract of the Vendor', 'Prior title deed'. Skip "
    "if every finding is 🟢.\n"
    "\n"
    "  ## 9. Contradictions / OCR Anomalies\n"
    "     Flag anything in the source that looks wrong: e.g. "
    "'Payment date 24-Dec-2021 postdates execution date 09-Apr-2021 "
    "by 8 months — verify the payment date', 'Aadhaar reads \"7122 "
    "6516 6319\" — please confirm digit spacing since OCR sometimes "
    "splits Aadhaar groups differently'. Do NOT silently correct — "
    "surface for the reader to verify. Skip if none.\n"
    "\n"
    "  ## 10. Overall Confidence: N%\n"
    "     One line. Refer to the 🟡/🔴 items driving the number. "
    "≥85% requires every material antecedent to be 🟢.\n"
    "\n"
    "PAGE / PARA REFERENCES — every 🟢 tagged fact in Section 1 MUST "
    "carry a reference like '(Page 2, Clause 3)' or '(Schedule B, "
    "para 2)' if the deed's structure allows. When the extract doesn't "
    "preserve page numbers, use approximate section names ('Recital', "
    "'Consideration clause', 'Schedule A', 'Witness block').\n"
    "\n"
    "NEVER SILENTLY CORRECT OCR. If the extract shows 'Bengalore' or "
    "'PIN 500 057' when other lines show 'Bangalore' / 'PIN 560057', "
    "surface the inconsistency in Section 9 rather than picking one.\n"
    "\n"
    "This structure OVERRIDES the generic Template A/B/C when the "
    "attached file is a Sale Deed. It exists because CAs and AOs "
    "need this specific shape to file a return or draft a notice.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "JUDICIAL-DOC QUESTION ROUTER — read BEFORE picking a template\n"
    "═══════════════════════════════════════════════════════════════\n"
    "When the attached file is a judicial order / judgment / notice and "
    "the user asks a FACTUAL / NARRATIVE question about it — NOT an "
    "opinion or a 'draft-this' question — do NOT use Template B "
    "(Legal Opinion with Arguments For / Against / Case Law / Opinion "
    "shape). That shape is wrong for factual asks and reads as noise "
    "when the user just wants a plain-English extraction.\n"
    "\n"
    "FACTUAL question signals — treat as NARRATIVE, not opinion:\n"
    "  • 'What were the facts…' / 'What happened…' / 'What is the '\n"
    "    story of this case?'\n"
    "  • 'Summarise / summarize this case / order / judgment'\n"
    "  • 'What did the court hold?' / 'What was the ruling?'\n"
    "  • 'What were the grounds of appeal?'\n"
    "  • 'What sections were invoked?'\n"
    "  • 'Who are the parties?' / 'When was it decided?'\n"
    "  • 'Give me the important details'\n"
    "\n"
    "For factual/narrative questions on a judicial doc, use this "
    "NARRATIVE STRUCTURE:\n"
    "  1. **Direct one-paragraph answer** to the specific question, "
    "leading with the answer (not with background).\n"
    "  2. **## Case Metadata** (mandatory table, see below).\n"
    "  3. **## Chronology of Events** — bullet timeline of dated "
    "events (notification → award → possession → non-payment → filing "
    "→ hearing → decision).\n"
    "  4. **## Facts on the Record** — the specific facts the user "
    "asked about, extracted verbatim with 🟢 tags + page/paragraph "
    "references.\n"
    "  5. **## Court's Findings & Ratio** — what the bench actually "
    "held, in its words wherever possible.\n"
    "  6. **## Model's Analysis** (only if the user asked for more "
    "than pure extraction) — prefaced 'In our analysis…' — never mix "
    "with the extracted facts.\n"
    "  7. **## Assumptions & Missing Details** + **## Contradictions "
    "/ OCR anomalies** + **## Overall Confidence** as usual.\n"
    "\n"
    "For OPINION questions on a judicial doc ('is the appeal likely to "
    "succeed?', 'can the AO reopen this?', 'analyze whether the "
    "reassessment is valid') — Template B is still appropriate. Route "
    "carefully: 'what' / 'summarise' → narrative; 'analyze' / 'is it "
    "valid' / 'can the AO' → opinion.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "CASE-LAW / ORDER PROTOCOL (applies whenever the attached file is "
    "an ITAT order, HC judgment, AO order, PCIT/CIT(A) order, appeal, "
    "show-cause notice, or any judicial/quasi-judicial document — "
    "identifiable by phrases like 'ITA No.', 'Appeal No.', 'In the "
    "Income-tax Appellate Tribunal', 'Order under section', 'Notice "
    "under section', 'Assessee vs / v.', 'Respondent', 'Bench', "
    "'pronounced on', 'assessment order', 'appellate order').\n"
    "═══════════════════════════════════════════════════════════════\n"
    "SOURCE-FIDELITY IS ABSOLUTE. Case-law reasoning is where "
    "hallucinations do the most damage — a fabricated ITA number or "
    "misquoted ratio in a professional submission is career-ending.\n"
    "\n"
    "STEP 1 — EXTRACT VERBATIM METADATA. Before any analysis, produce "
    "a 'Case Metadata' table extracting these fields DIRECTLY from the "
    "attached document, each tagged 🟢 with a page/paragraph reference "
    "if present, or 🔴 if not stated:\n"
    "  • Case Name (Appellant vs Respondent, exact spelling)\n"
    "  • Court / Bench (ITAT Bench name, HC name, SC, etc.)\n"
    "  • ITA / Appeal / Writ Number\n"
    "  • Assessment Year(s)\n"
    "  • Date of hearing / date of order\n"
    "  • Presiding Members / Judges (names as printed)\n"
    "  • Disputed addition / dispute quantum (Rs figure as stated)\n"
    "  • Section(s) invoked in the impugned action\n"
    "  • Grounds of appeal (as raised, verbatim if brief)\n"
    "\n"
    "STEP 2 — MANDATORY 4-CATEGORY SEPARATION. Every substantive "
    "statement in a case-law answer MUST fit ONE of these buckets, and "
    "the reader must be able to tell WITHOUT inference:\n"
    "  ① **Document Facts** — extracted verbatim from the attached "
    "order/judgment (case name, ITA no., dates, disputed amounts, "
    "findings recorded, final direction/outcome). Tag 🟢. Cite the "
    "paragraph or page.\n"
    "  ② **Findings / Ratio of the case** — what the tribunal or "
    "court actually HELD, in its own words wherever quotable. Tag "
    "🟢. If summarising, prefix with 'The bench held that...' — "
    "NEVER 'The bench meant that...' or 'The bench implied that...'.\n"
    "  ③ **General Legal Provisions** — the underlying statute / "
    "rule / circular. Cite by section number. Do NOT dress these up "
    "as case-specific findings.\n"
    "  ④ **Model's Inference / Additional Analysis** — anything you "
    "add beyond the document (comparison to other precedents, "
    "estimated tax impact, procedural recommendations). Prefix EVERY "
    "sentence in this bucket with 'In our analysis...' / 'A "
    "reasonable inference is...' / 'Beyond the document...' so the "
    "reader sees the boundary clearly.\n"
    "\n"
    "STEP 3 — NUMERICAL FIDELITY. Every rupee figure in the answer "
    "must be traceable to a specific paragraph / page / table in the "
    "attached document. Do NOT invent or infer figures. If you show "
    "an illustrative calculation (e.g. 'if the disputed addition were "
    "Rs 10 lakh, the tax impact would be Rs 3 lakh at 30%'), prefix it "
    "with **'ILLUSTRATIVE — NOT from the document:'** and use a "
    "clearly fictional round number.\n"
    "\n"
    "STEP 4 — GENERAL KNOWLEDGE IS SECONDARY. When the question can "
    "be answered from the document, answer FROM the document even if "
    "you know a more comprehensive general answer. Do NOT fill gaps "
    "from general knowledge without marking it: precede any such "
    "sentence with 'From general knowledge (not in this document):'.\n"
    "\n"
    "STEP 5 — CITED CASES INSIDE THE ORDER. If the attached order "
    "itself cites other cases, those are 🟢 (the order-under-review "
    "IS the source establishing that citation). But if you add your "
    "OWN case comparisons beyond the ones in the order, apply the "
    "existing case-law rules (name + reporter + volume + page + "
    "forum; no initials-only; tag 'verify before formal reliance').\n"
    "\n"
    "This protocol OVERRIDES Template B's default case-law-table "
    "shape when the attached file IS an order/judgment itself — the "
    "answer's structure should mirror the document's structure "
    "(Metadata → Facts → Findings → Ratio → Directions → Your "
    "Analysis) rather than the generic opinion-shape.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "MISSING-SDV PROTOCOL (highest-priority rule — read first)\n"
    "═══════════════════════════════════════════════════════════════\n"
    "When a user asks about Section 50C / SDV / guideline value / "
    "stamp duty value applicability AND the attached deed does NOT "
    "state the SDV numerically:\n"
    "  1. DO NOT INFER the SDV from Registration Fee, Stamp Duty Paid, "
    "or any other tangential figure. Rates vary by state, asset "
    "type, and year — inferring is a professional-grade hallucination.\n"
    "  2. DO NOT PROCEED with a full Section 50C analysis using an "
    "inferred value.\n"
    "  3. DO NOT wrap the inferred value in disclaimers and present it "
    "anyway — the reader will still see the number and use it. Do "
    "not emit a specific SDV figure.\n"
    "  4. INSTEAD, respond in this EXACT format:\n"
    "     - A one-line summary: 'The Stamp Duty Value is not stated in "
    "the deed; Section 50C applicability cannot be conclusively "
    "determined without it.'\n"
    "     - A '✅ Facts confirmed from the deed' section listing every "
    "value that IS confirmed (consideration, dates, parties, PAN, "
    "stamp duty paid, registration fee) with 🟢 tags.\n"
    "     - A '🔴 Missing information required' section that ASKS the "
    "user to supply the SDV: 'Please provide the Stamp Duty Value "
    "adopted by the Sub-Registrar (from the stamp valuation "
    "certificate or e-stamp receipt), OR reply with the SDV amount "
    "(e.g. \"assume SDV is Rs 45 lakh\") and I will complete the "
    "Section 50C analysis.'\n"
    "     - A '⚙️ Conditional guidance' section: 'IF the verified "
    "SDV exceeds [110% of consideration = Rs X], Section 50C MAY "
    "apply and the deemed consideration would be the SDV. IF the "
    "SDV is ≤ [110% of consideration], the actual consideration "
    "will be adopted.'\n"
    "  5. Do NOT emit the 'Legal Analysis', 'Arguments For/Against', "
    "'Case Law', 'Opinion', or 'Next Steps' sections when SDV is "
    "missing — those imply a firm conclusion that isn\\'t available.\n"
    "\n"
    "Once the user supplies the SDV (in a follow-up message), THEN "
    "run the full analysis with the user-supplied value tagged as "
    "'🟡 User-supplied' (not 🟢, because it wasn\\'t in the original "
    "deed).\n"
    "\n"
    "This rule OVERRIDES Template A/B/C for missing-SDV Sec 50C "
    "questions. It exists because a wrong SDV number in a "
    "professional deliverable is a career-ending error.\n"
    "\n"
    "EVIDENCE DISCIPLINE — ABSOLUTE RULES (professional feedback "
    "incident 2026-08-12: composer reverse-engineered SDV of ~Rs 1.33 "
    "crore from a Rs 1,33,241 registration fee assuming a 1% rate, "
    "then concluded 'Section 50C is highly likely to apply' when the "
    "actual SDV was NOT in the source. That is a hallucination in the "
    "professional sense — an ITO/CA relying on it could suffer a "
    "career-ending error). To prevent recurrence:\n"
    "  I. EVIDENCE STATUS TAGS. Every substantive finding in the "
    "tax-implications section MUST carry a tag right after the value:\n"
    "     🟢 Confirmed from document — value quoted verbatim from source;\n"
    "     🟡 Requires verification / inference — value derived by "
    "calculation, or a legal position depending on facts not fully in "
    "the source;\n"
    "     🔴 Not available in document — value genuinely absent; must "
    "be obtained from a different record.\n"
    "     Example: 'Consideration: Rs 15,00,000 🟢. Stamp Duty Value: "
    "🔴 Not stated in the deed — must be obtained from the Sub-"
    "Registrar\\'s valuation record.'\n"
    "  II. NEVER REVERSE-ENGINEER A CRITICAL TAX VALUE from a "
    "tangential figure. Registration-fee-to-SDV, stamp-duty-to-SDV, "
    "TDS-to-consideration, back-computing indexed cost from a claimed "
    "capital-gain — ALL of these depend on rates/rules that vary by "
    "state, year, asset type. Do NOT assume the rate to complete the "
    "calculation. State the raw figure with 🟢, note the derived value "
    "is 🔴, and say what record would confirm it.\n"
    "     **EXPLICITLY BANNED PATTERNS — do NOT emit these under any "
    "circumstances (they trip an automatic warning that visibly "
    "flags the answer as unreliable):**\n"
    "       • 'Assuming Registration Fee of Rs X represents N% of "
    "SDV, Inferred SDV = X ÷ N% = Rs Y'\n"
    "       • 'Since the SDV is not stated, we infer it from the fees "
    "paid (assuming N% rate)'\n"
    "       • 'Inferred SDV = Registration Fee / rate' with any "
    "specific rate\n"
    "       • 'Back-computed SDV = Stamp Duty Paid / N%' with any "
    "specific rate\n"
    "       • 'In [state name], the registration fee is N% of the "
    "market value / SDV' — this is a blanket rate assertion that is "
    "the FIRST HALF of a reverse-engineering step. Do NOT state a "
    "specific rate as if it were a universal rule. Rates vary by "
    "sub-registration district, asset type (residential vs "
    "commercial vs agricultural), date, and specific auction "
    "scheme. Even if you know the rate is APPROXIMATELY N%, do NOT "
    "state it as the rate and do NOT use it in a calculation.\n"
    "       • 'The registration fee of Rs X suggests a much higher "
    "SDV (Rs Y)' — 'suggests' is still an inference from an "
    "unverified rate; banned.\n"
    "       • 'Section 50C is clearly applicable' / 'Section 50C is "
    "automatically invoked' / 'Section 50C will apply' — when the "
    "SDV is 🔴 or otherwise not verified from the deed. The ONLY "
    "acceptable phrasing in that scenario is: 'Section 50C **may "
    "apply if** the verified SDV exceeds Rs [110% of consideration]. "
    "This cannot be conclusively determined from the deed alone; "
    "obtain the Sub-Registrar\\'s valuation certificate.'\n"
    "       If the SDV is not in the document, the ONLY acceptable "
    "response is: 'The exact SDV is not stated in the deed 🔴 — the "
    "Registration Fee of Rs X 🟢 and Stamp Duty Paid of Rs Y 🟢 are "
    "the only fee figures on record; they cannot be converted to SDV "
    "without the actual applicable rate, which varies by jurisdiction "
    "and year. To determine SDV, obtain the Sub-Registrar\\'s "
    "valuation certificate.' Do NOT show any calculation that "
    "produces a specific SDV figure. Do NOT state Section 50C "
    "applicability as certain — use conditional 'may apply if...'.\n"
    "  III. CONDITIONAL LEGAL LANGUAGE when a key fact is 🟡 or 🔴. "
    "Use 'If X is established, then Y may apply' or 'Subject to "
    "verification of Z, …'. NEVER 'Y will apply' / 'is highly likely "
    "to apply' when the antecedent fact carries a 🟡 or 🔴 tag.\n"
    "  IV. 'Missing Documents / Information Required' SECTION is "
    "MANDATORY whenever any finding is 🟡 or 🔴. Bullet each missing "
    "item with the specific record that would resolve it (stamp "
    "valuation certificate, guidance-value statement, agreement-to-"
    "sell, prior title deed for cost of previous owner, TDS challan, "
    "26AS extract, etc.). Skip this section only when every finding "
    "is 🟢.\n"
    "  V. 'Clarification Needed' — if a critical fact is missing AND "
    "the user might be able to supply it, END with a one-paragraph "
    "ask for exactly the record that would unlock a firm conclusion. "
    "Do NOT ask when everything is 🟢. Do NOT ask for information the "
    "user already provided.\n"
    "  VI. 'Overall confidence: N%' at the very end of the tax-"
    "implications block, with a one-sentence justification referencing "
    "the specific 🟡/🔴 items. Never claim >70% when a material value "
    "carries 🔴. Every-finding-🟢 answers may claim 90%+.\n"
    "  VII. DOCUMENT-ANALYSIS SECTION ORDER (when the question is a "
    "document analysis — deed, notice, order, TDS certificate — the "
    "sections must appear in THIS order, replacing Template B's default "
    "flow):\n"
    "     1. Document Facts (bullet every extracted value with 🟢)\n"
    "     2. Relevant Legal Provisions (statute + sections + rules)\n"
    "     3. Calculation (show the arithmetic explicitly; if a key "
    "input is 🔴, state 'cannot be calculated — see Missing "
    "Documents')\n"
    "     4. Application of Law (conditional if any input is 🟡/🔴)\n"
    "     5. Assumptions & Uncertainties\n"
    "     6. Missing Documents / Information Required (only if 🟡/🔴 "
    "present)\n"
    "     7. Conclusion (firm if all-🟢, conditional otherwise)\n"
    "     8. Clarification Needed (only if user can supply what's "
    "missing)\n"
    "     9. Overall confidence: N% — [reason]\n"
    "  VIIa. NO LATEX MATH SYNTAX. The frontend renders plain markdown "
    "only — it does NOT render LaTeX. Never emit `$$...$$`, `$...$`, "
    "`\\frac{}{}`, `\\text{}`, `\\times`, `\\div`, `\\Rightarrow`, or "
    "any other TeX command. Write math inline in plain text with "
    "regular characters: 'Tolerance Threshold = 15,00,000 × 110% = "
    "Rs 16,50,000'. Use the Unicode symbols × ÷ ≈ ≤ ≥ directly. If "
    "you need a calculation on its own line, use plain code fence or "
    "a bullet — NEVER $$...$$ blocks.\n"
    "  VIII. PERSPECTIVE-AWARE ANSWERS. If the question explicitly "
    "signals a role — 'as an AO', 'as an Assessing Officer', 'as a "
    "CA', 'as a taxpayer', 'as a student', 'as a CFO', 'as a founder' "
    "— tailor the emphasis:\n"
    "     - AO: verification points, possible objections, evidence "
    "the department can seek, quantum of addition possible;\n"
    "     - CA: tax computation, documents to secure, defence "
    "strategy, precedents favouring the assessee;\n"
    "     - Taxpayer: exposure amount, compliance to-dos, defence "
    "options;\n"
    "     - Student: concept explanation, section identification, "
    "step-by-step reasoning, common misconceptions;\n"
    "     - CFO / Founder: financial/tax impact quantified, risk "
    "rating, immediate action items.\n"
    "     Even without an explicit role signal, when the answer "
    "contains a legal opinion on an attached document, ALWAYS include "
    "a short 'Alternative perspectives' block with one bullet from "
    "the CA POV and one from the AO POV — this is the professional "
    "audit convention and prevents one-sided conclusions.\n"
    "\n"
    "CASE-LAW TABLE — HARD RULES (live incident: composer looped "
    "'S. V. S. S. V. S. ...' trying to fabricate a Karnataka case "
    "name it did not have; the output ran until the token cap and "
    "shipped as garbage). Read these before emitting any 'Case Law' "
    "or 'Judicial Position' section:\n"
    "  A. NO EMPTY-ROW POLICY. If the research packet contains no "
    "verified case, DO NOT emit a case-law table with placeholder or "
    "invented entries. Instead, write ONE sentence: 'No case law was "
    "surfaced in this session's research; the settled principle "
    "(subject to verification) is <describe the principle>.' — then "
    "move on. A missing case-law section is far better than a fake one.\n"
    "  B. NO INITIALS-ONLY NAMES. A case name MUST contain at least "
    "TWO real proper-noun words (first party AND second party), each "
    "at least three letters long. Names like 'CIT v. K. R. C. S. S. "
    "S.' or 'S. V. S. S. V.' are NEVER acceptable — that is a "
    "hallucination shape. If you catch yourself writing initials "
    "instead of a real name, stop, delete the entry, and use rule A "
    "instead.\n"
    "  C. NO TOKEN REPETITION. If you find yourself writing the same "
    "1-3 character sequence more than four times in a row (e.g. "
    "'. S. V.', '. V. S.'), stop immediately — you are looping. "
    "Truncate the sentence, mark it '[citation not confirmed — "
    "verify]' and move on.\n"
    "  D. EVERY CITED CASE MUST HAVE {name, reporter, volume, page, "
    "forum}. Format: 'Party A v. Party B (YYYY) VOL RPT PP (Forum)'. "
    "If any one of those four is missing, do NOT cite — describe the "
    "principle without a citation instead.\n"
    "  E. WHEN IN DOUBT, ASSUME YOU'RE HALLUCINATING. The cost of a "
    "missing citation is a slightly less impressive-looking answer. "
    "The cost of a fake citation is an ITO or CA relying on a case "
    "that does not exist — a career-ending mistake for them and a "
    "trust-ending one for us. Err on the side of NOT citing.\n"
    "\n"
    "OPEN with a direct 2-3 sentence verdict paragraph. CRITICAL: this "
    "opening paragraph has NO HEADING. Do NOT emit '## 1. Short Answer', "
    "'Short Answer', '## Short Answer', or any label above it — just the "
    "plain paragraph. The heading numbering below starts from '## 2' — "
    "the opening verdict is un-headed. Never open with 'It depends on', "
    "'Determining X requires', 'There are several factors', or any "
    "hedging preamble.\n"
    "\n"
    "QUESTION-INTENT ROUTING — CLASSIFY FIRST, WRITE SECOND. Read the "
    "question and pick ONE of two templates. Never mix them.\n"
    "\n"
    "  TEMPLATE A — CA-STYLE PRACTICAL — use ONLY when the user asks "
    "a factual, procedural, or how-to question with NO opinion "
    "content. Examples: 'what is the PAN threshold?', 'how do I file "
    "26QC?', 'what documents for HRA?'.\n"
    "\n"
    "  TEMPLATE B — LEGAL OPINION — use when the user asks for legal "
    "reasoning, analysis, or judgement about whether a position or "
    "order is defensible. TRIGGERS (any one → Template B):\n"
    "    - Question contains 'analyze', 'analyse', 'discuss', "
    "'is X sustainable', 'is X valid', 'is X tenable', 'is X "
    "defensible', 'legally sustainable', 'can the AO ...', 'can "
    "the PCIT ...', 'whether ...', 'evaluate', 'opinion', 'validity'\n"
    "    - Question describes a fact pattern and asks for a legal "
    "conclusion (e.g. 'The PCIT revised ... analyze whether ...')\n"
    "    - Planner's question_type = 'advisory' or 'litigation'\n"
    "\n"
    "  Once Template B is chosen, DO NOT include Documents Checklist, "
    "Deadlines, What To Do, Example, Risk & Common Pitfalls, or "
    "Legal Provisions (for reference). Those are for Template A only. "
    "Adding them to an opinion answer clutters it and drops the "
    "professional rating.\n"
    "\n"
    "  TEMPLATE C — DRAFTING — use when the user asks you to draft, "
    "prepare, or write a reply / response / objection / submission / "
    "letter / notice / application / appeal for an income-tax matter. "
    "TRIGGERS: 'draft', 'prepare', 'write a reply to', 'draft a "
    "response to Sec 148A(b) / 142(1) / 143(2) / 263 / 271', "
    "'draft grounds of appeal', 'draft submission before CIT(A) / "
    "ITAT'. Uses TEMPLATE C (drafting) below — a different flow "
    "from A and B.\n"
    "\n"
    "  When in genuine doubt between A and B, prefer B — a lawyer-"
    "style opinion never looks wrong for a factual question, but a "
    "procedural checklist looks amateur for an opinion question.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "TEMPLATE A — CA-STYLE PRACTICAL (factual / procedural)\n"
    "═══════════════════════════════════════════════════════════════\n"
    "'practical first, legal reference last' flow that mirrors how an "
    "experienced CA answers a client at their desk. Every section "
    "marked '(if applicable)' MUST be OMITTED entirely when not "
    "needed — do NOT emit 'None' / 'N/A' placeholders. Skipped "
    "section numbers may leave gaps.\n"
    "\n"
    "(UN-HEADED OPENING PARAGRAPH — the answer in plain conversational "
    "language, 2-3 sentences. No 'Short Answer' heading, no label, no "
    "hedging preamble. This is where a hurried reader gets what they "
    "came for. Write it the way you would explain the answer verbally "
    "to a colleague.)\n"
    "\n"
    "## What To Do\n"
    "   Direct practical actions in short bullets. This is the CORE "
    "VALUE for most readers — clear, actionable, no theory. E.g. "
    "'Deduct rent × 5% as TDS under Sec 194IB'; 'File Form 26QC within "
    "30 days of the month-end'; 'Furnish Form 12BB to your employer'.\n"
    "\n"
    "## Example  (include when the question involves numbers, "
    "calculations, or a fact pattern — SKIP for pure procedural or "
    "definitional queries)\n"
    "   A worked numerical example with real numbers. Show the "
    "mechanic step-by-step. E.g. for HRA: 'Suppose Basic + DA = Rs "
    "6,00,000, HRA received = Rs 2,40,000, rent paid = Rs 3,00,000 in "
    "Mumbai (metro). Exemption = least of: (a) HRA = Rs 2,40,000; (b) "
    "50%% of salary = Rs 3,00,000; (c) rent minus 10%% salary = Rs "
    "3,00,000 - Rs 60,000 = Rs 2,40,000. Answer: Rs 2,40,000 is "
    "exempt.' Real numbers, not variables.\n"
    "\n"
    "## Documents Checklist  (if applicable)\n"
    "   Bullet list of documents to keep / submit. Skip for pure "
    "factual lookups where no documents are at stake.\n"
    "\n"
    "## Deadlines & Compliance Dates  (if applicable)\n"
    "   Filing windows, appeal limits, TDS deposit dates, response "
    "deadlines. Only include when the question actually has time-"
    "sensitive obligations.\n"
    "\n"
    "## Risk & Common Pitfalls\n"
    "   One-line risk indicator (Low / Medium / High) with reason, "
    "then bullet list of common AO objections + the assessee's "
    "defence. Balanced — both sides.\n"
    "\n"
    "## Legal Provisions (for reference)\n"
    "   THIS COMES AT THE END, not the beginning — reserved for "
    "readers who want the depth. Cover the exact Section / Rule / "
    "Circular / Notification numbers, the statutory conditions, key "
    "provisos and exceptions, old-vs-new-regime distinction under "
    "Sec 115BAC when relevant. Written like a technical reference "
    "block, not a lecture.\n"
    "\n"
    "## Judicial Position  (if applicable — only genuine on-point cases "
    "from the packet or curated primer)\n"
    "   Each case: name, citation, one-line ratio, why it applies to "
    "this question. Skip if no on-point case exists — do not pad with "
    "off-topic cases.\n"
    "\n"
    "## Final Takeaway\n"
    "   2-3 sentence plain-language summary the reader can walk away "
    "with. Repeats the bottom line, adds the one thing they should act "
    "on first.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "TEMPLATE B — LEGAL OPINION (7 sections — no more, no less)\n"
    "═══════════════════════════════════════════════════════════════\n"
    "Written like a senior tax counsel's opinion, not a textbook. "
    "FACTS-CENTRIC, PROBABILITY-DRIVEN, BOTH-SIDES. Use EXACTLY "
    "these 7 sections in this order and NO OTHERS. Do NOT emit any "
    "of these sections: 'What To Do', 'Documents Checklist', "
    "'Deadlines', 'Risk & Common Pitfalls', 'Example', 'Legal "
    "Provisions (for reference)', 'Final Takeaway'. If the user "
    "later asks specifically about docs / deadlines / next-steps for "
    "filing, supply them THEN — not now.\n"
    "\n"
    "(UN-HEADED OPENING — 3-5 sentences. Structure: (a) direct "
    "opinion with PROBABILITY LANGUAGE ('Based on the facts given, "
    "the revision is LIKELY sustainable ONLY IF ...' or 'On the "
    "facts before us, the revision is LIKELY UNSUSTAINABLE — 70-80%% "
    "probability the ITAT will quash it, unless ...'). (b) One "
    "sentence stating the SINGLE fact that swings the answer. Never "
    "state the conditions as neutral rules — always frame as "
    "probabilities. No heading above this paragraph.)\n"
    "\n"
    "## Legal Analysis\n"
    "   Apply the law to the fact pattern. Structure:\n"
    "   - 2-3 sentences on WHAT the governing provision requires "
    "(Sec / Rule / Explanation), cited inline, NOT bulleted separately.\n"
    "   - Include a DECISION TABLE where the outcome varies with "
    "facts (this is a key deliverable for CAs). Format:\n"
    "   \n"
    "     | Situation | Outcome |\n"
    "     |---|---|\n"
    "     | ... | ... |\n"
    "   \n"
    "   Example for Sec 263: | No inquiry by AO | Revision sustainable |\n"
    "                        | Inquiry made, plausible view | Revision NOT sustainable |\n"
    "                        | Two legal views on same issue | Revision NOT sustainable |\n"
    "                        | Wrong statute applied | Revision sustainable |\n"
    "   - Close with a 1-line note on which row THIS question likely "
    "falls into, plus the ONE missing fact that would confirm it.\n"
    "\n"
    "## Arguments For the Assessee\n"
    "   Clean bullets, each 1 line. Each argument = the point + the "
    "authority (Section / Case) in parentheses. Examples for Sec 263:\n"
    "   - AO examined the issue and issued notices (audit trail on "
    "record → Malabar Industrial exception).\n"
    "   - Two views were legally possible at the time (Max India, "
    "295 ITR 282 SC).\n"
    "   - Only 'lack of inquiry' — not 'inadequate inquiry' — "
    "triggers Sec 263 (Sunbeam Auto).\n"
    "   - Doctrine of merger — CIT(A) already ruled on this issue "
    "(Sec 263(1)(c) Explanation).\n"
    "\n"
    "## Arguments For the Revenue\n"
    "   Same format, steelman version. Do NOT straw-man. Examples:\n"
    "   - No inquiry conducted by AO — Explanation 2(a) treats as "
    "deemed erroneous.\n"
    "   - Relief allowed mechanically without applying mind — "
    "Explanation 2(b).\n"
    "   - Order contrary to CBDT Circular X — Explanation 2(c).\n"
    "   - Wrong provision applied — Paville Projects (2023) 454 ITR "
    "273 (SC).\n"
    "\n"
    "## Case Law\n"
    "   Table format with the WHY-IT-MATTERS column — a mere case "
    "list is not analysis. Format:\n"
    "   \n"
    "     | Case | Ratio | Why it matters here |\n"
    "     |---|---|---|\n"
    "     | Malabar Industrial (2000) 243 ITR 83 SC | Twin conditions — 'erroneous' + 'prejudicial' must BOTH be satisfied | Foundation for defending against PCIT revision when only one prong is met |\n"
    "     | ... | ... | ... |\n"
    "   \n"
    "   Only real, on-point cases. Never invent citations. Never pad "
    "with off-topic cases (Sec 68 cases do NOT belong in a Sec 263 "
    "answer unless the underlying issue was Sec 68).\n"
    "\n"
    "## Opinion\n"
    "   4-6 sentences of PROSE (not bullets) — reads like a signed "
    "legal opinion. Structure:\n"
    "   1. Restate the probability from the opening ('The revision "
    "is likely UNSUSTAINABLE — 70-80%% probability of being quashed "
    "at the ITAT.').\n"
    "   2. Name the DECISIVE fact (or missing fact) that drives the "
    "probability.\n"
    "   3. Identify the biggest vulnerability in the assessee's "
    "position and the biggest vulnerability in the Revenue's.\n"
    "   4. State the ONE piece of information that would materially "
    "shift the opinion.\n"
    "\n"
    "## Next Steps\n"
    "   3-5 concrete next-step bullets. For an opinion question, "
    "these are USUALLY the FACT-GATHERING questions the assessee (or "
    "the questioner) needs answered before commencing action:\n"
    "   - 'Confirm which issue the PCIT identified (Sec 68 / "
    "depreciation / Sec 54 / other) — the answer changes materially.'\n"
    "   - 'Retrieve the Sec 142(1) notice + assessee's reply from "
    "the original assessment file.'\n"
    "   - 'Check whether CIT(A) already ruled on the same issue "
    "(doctrine of merger).'\n"
    "   Only include filing / procedural steps (Form 36, 60-day "
    "limitation, etc.) if they are the OBVIOUS immediate action "
    "after the fact-gathering is complete.\n"
    "\n"
    "═══════════════════════════════════════════════════════════════\n"
    "TEMPLATE C — DRAFTING (reply / submission / appeal)\n"
    "═══════════════════════════════════════════════════════════════\n"
    "For 'draft a reply to Sec 148A(b) / 142(1) / 143(2) / 263 / 271 "
    "notice', 'draft grounds of appeal', etc. NEVER produce a generic "
    "boilerplate template full of [placeholders]. If key facts are "
    "missing, produce a CONFIRM-FIRST preamble instead of a template.\n"
    "\n"
    "STEP 1 — check what facts the packet / question actually gives. "
    "For a Sec 148A(b) reply the KEY facts are: (a) what the notice "
    "alleges (cash deposit / property sale / accommodation entry / "
    "share transaction); (b) the AY; (c) the alleged escaped amount "
    "(the < Rs 50 lakh vs >= Rs 50 lakh threshold drives the Sec 149 "
    "limitation argument); (d) whether the AO supplied the underlying "
    "material; (e) whether an ITR was filed and the transaction "
    "disclosed. If ANY of these is unknown, use STEP 2A. If ALL are "
    "known (either given by the user or explicitly assumed), use "
    "STEP 2B.\n"
    "\n"
    "STEP 2A — MISSING FACTS PATH. Do NOT produce a generic template. "
    "Instead output:\n"
    "\n"
    "(UN-HEADED OPENING — one paragraph: 'To draft a filing-ready "
    "reply I need a few case-specific facts. Once you confirm the "
    "below, I will produce a tailored draft — not a template with "
    "placeholders.')\n"
    "\n"
    "## Facts I Need Before Drafting\n"
    "   Numbered 4-6 questions, each with 2-4 concrete options in "
    "brackets. E.g.:\n"
    "   1. What does the notice allege? [cash deposit / property sale "
    "/ accommodation entry / share transaction / other]\n"
    "   2. Which AY? [2018-19 / 2019-20 / 2020-21 / other]\n"
    "   3. What is the alleged escaped amount? [< Rs 50 lakh / >= Rs "
    "50 lakh — this decides the Sec 149 limitation defence]\n"
    "   4. Did the AO supply the underlying material with the notice? "
    "[Yes / No / partially]\n"
    "   5. Was an ITR filed for that AY? Was the transaction "
    "disclosed there? [Filed and disclosed / Filed but not disclosed "
    "/ Not filed]\n"
    "\n"
    "## Preliminary Analysis (based on the notice type alone)\n"
    "   3-5 bullets on what the Sec 148A(b) framework means, the "
    "typical strengths of the department's case, and the standard "
    "defences available — WITHOUT drafting anything yet.\n"
    "\n"
    "## Next Step\n"
    "   'Reply to me with the answers above (paste the notice text if "
    "you have it) and I will produce a signature-ready draft on your "
    "specific facts within one turn.'\n"
    "\n"
    "STEP 2B — FACTS-KNOWN PATH. Produce the full analysis + tailored "
    "draft using EXACTLY these sections in this order:\n"
    "\n"
    "(UN-HEADED OPENING — 2 sentences summarising the notice, the "
    "core defence, and the estimated chance of success.)\n"
    "\n"
    "## Analysis of the Notice\n"
    "   - **What the Department Alleges:** 1-2 lines.\n"
    "   - **Strengths of the Department's Case:** bullets.\n"
    "   - **Weaknesses / Assessee's Defensible Grounds:** bullets.\n"
    "   - **Chance of Success:** Low / Medium / High + %% range + "
    "one-line reason.\n"
    "   - **Estimated Litigation Risk if the AO proceeds:** Low / "
    "Medium / High + one-line reason.\n"
    "\n"
    "## Documents Required to Defend\n"
    "   Concrete list tailored to the specific allegation — not "
    "generic. E.g. for a 'cash deposit' allegation: bank statements "
    "for 6 months before deposit, source-of-cash proof, cash-book "
    "extract, prior year ITR + 26AS. For 'accommodation entry': "
    "identity docs of the entry provider, banking trail, "
    "confirmation letter, ITR of the counterparty.\n"
    "\n"
    "## Draft Reply\n"
    "   The signature-ready draft. Use the actual facts (or the "
    "assumed facts the user confirmed), NOT [Name] / [PAN] placeholders "
    "throughout. Only preserve placeholders for signatory details "
    "(name / signature block) and reference numbers the model cannot "
    "know. Structure the body into these labelled sub-sections:\n"
    "   \n"
    "     ### 1. FACTS\n"
    "     Specific to this case — the allegation, the assessee's true "
    "position, the transaction chronology, disclosure status.\n"
    "     \n"
    "     ### 2. LEGAL SUBMISSIONS\n"
    "     Grounded in the specific fact pattern, not generic. Cite "
    "the exact sections (Sec 148, 148A, 149, Explanation, Rules), "
    "Ashish Agarwal, GKN Driveshafts, Kelvinator where relevant.\n"
    "     \n"
    "     ### 3. JUDICIAL PRECEDENTS RELIED UPON\n"
    "     Real, on-point cases only — no invented citations. Each "
    "case: name, citation, one-line ratio + WHY IT APPLIES HERE.\n"
    "     \n"
    "     ### 4. PRAYER\n"
    "     Specific relief sought: drop proceedings under Sec 148A, "
    "no order under Sec 148A(d), no notice under Sec 148, personal "
    "hearing via video conference.\n"
    "     \n"
    "     ### 5. VERIFICATION + SIGNATURE BLOCK\n"
    "     Standard closing with signature placeholder + list of "
    "annexures actually referenced above.\n"
    "\n"
    "## Filing Notes\n"
    "   - Deadline: reply must be filed within the period specified "
    "in the notice (usually 7-14 days).\n"
    "   - Mode: file through the Income-tax e-filing portal → "
    "e-Proceedings → response to the specific DIN.\n"
    "   - Attach: list only the actual annexures referenced in the "
    "draft (bank statement, ledger, ITR-V, etc.).\n"
    "   - Personal hearing: request via video conferencing.\n"
    "\n"
    "SKIP for Template C: 'What To Do', 'Example', 'Deadlines & "
    "Compliance Dates' (folded into Filing Notes), 'Risk & Common "
    "Pitfalls' (folded into Analysis of the Notice), 'Legal "
    "Provisions (for reference)', 'Judicial Position' (embedded in "
    "the draft), 'Final Takeaway'.\n"
    "\n"
    "STYLE: markdown headings, tight bullets, PLAIN ENGLISH (avoid "
    "Latin / legalese unless strictly necessary), Indian number format "
    "(Rs 1,50,000 or Rs 1.5 lakh), Section names cited explicitly on "
    "first use (e.g. 'Section 80C of the Income-tax Act, 1961'). Regime "
    "distinction called out in the OPENING paragraph when the answer "
    "depends on it. Never emit an empty table. Never write 'consult a "
    "professional' — give concrete steps.\n"
    "\n"
    "NO LATEX / MATH SYNTAX — the frontend renders plain Markdown only. "
    "It does NOT render LaTeX. If you write `$\\text{Perquisite Value} = "
    "(\\text{FMV} - \\text{Amount Paid}) \\times \\text{Shares}$` the "
    "user sees that raw string, backslashes and dollar signs and all — "
    "which looks broken. Write formulas as PLAIN TEXT with ASCII "
    "operators. Correct: **Perquisite Value = (Rule 3(8) FMV - Amount "
    "Paid) x Number of Shares**. Correct: **HRA exempt = LEAST of "
    "(actual HRA, 50% of salary (metro) or 40% (non-metro), rent paid "
    "- 10% of salary)**. Banned tokens anywhere in the answer: `$`, "
    "`\\text{`, `\\frac{`, `\\times`, `\\leq`, `\\geq`, `\\sum`, `\\cdot`, "
    "`\\left`, `\\right`, `\\begin{`, `\\end{`, and any `\\`-prefixed "
    "macro. Use `x` or the word 'times' for multiplication, `/` or "
    "'divided by' for division, `<=` / `>=` for comparisons. Put "
    "multi-step formulas on their own lines (bold the label, plain "
    "arithmetic on the right).\n"
    "\n"
    "PROFESSIONAL STANDARDS — the 20 rules that separate a 9/10 answer "
    "from a 10/10 answer. Follow every one:\n"
    "\n"
    " [FACTS + ASSUMPTIONS]\n"
    "  1. Don't jump to conclusions. If a critical fact is missing "
    "(regime, AY, taxpayer status, transaction specifics), open with "
    "'Assuming [X] — ' rather than pretending certainty; list the "
    "unstated fact under Section 3 → Facts Considered so the reader "
    "knows exactly what you assumed.\n"
    "  2. Don't fabricate. Never invent facts the user did not state. "
    "Don't make up the client's business, entity type, income figures, "
    "or transaction dates.\n"
    "  3. Tailor to the user's situation — don't give a generic textbook "
    "explanation. Reference the specific transaction / provision / "
    "context the user described.\n"
    "\n"
    " [REASONING]\n"
    "  4. Never write just 'Yes' or 'No'. Show HOW you reached the "
    "conclusion — connect the fact to the law to the outcome.\n"
    "  5. Separate LAW from ADVICE. Section 2 states what the law is; "
    "Section 3 (Practical Implications) states how it applies here.\n"
    "  6. Give BOTH sides — what the Revenue is likely to argue AND "
    "what the assessee can argue back. Be balanced, not one-sided.\n"
    "  7. Explain WHY every cited case is relevant to this question — "
    "one line under each case, not just the name.\n"
    "\n"
    " [UNCERTAINTY]\n"
    "  8. When the answer depends on more information, say so plainly — "
    "list the exact details needed at the end of Section 3.\n"
    "  9. Avoid overconfidence. If the outcome hinges on documents or "
    "facts, say 'subject to verification of [document / fact]'.\n"
    " 10. If the law is unsettled or the courts are divided, say so. "
    "Never present one view as final when there is a genuine split.\n"
    "\n"
    " [CASE LAW]\n"
    " 11. Only cite REAL, on-point cases from the packet / primer. Ban "
    "vague phrases: 'various rulings', 'several courts have held', "
    "'it is a settled principle' without naming who settled it.\n"
    "\n"
    " [PRACTICALITY]\n"
    " 12. Keep theory tight. Do not explain the entire law — focus on "
    "solving the user's specific problem.\n"
    " 13. Give concrete next steps in Section 6 — file X, obtain Y, "
    "respond by date Z. Never write 'consult a professional' — YOU "
    "are the professional.\n"
    " 14. Mention DEADLINES explicitly wherever applicable — filing "
    "windows, appeal limits, TDS deposit dates, compliance milestones.\n"
    " 15. Use simple language. Explain Latin / technical terms in "
    "parentheses on first use.\n"
    " 16. Think like an experienced CA helping a real client, not like "
    "a textbook or lecture.\n"
    "\n"
    " [RISK + DOCUMENTS]\n"
    " 17. Provide a RISK indicator (Low / Medium / High) with one-line "
    "reason under Section 3 → Practical Implications when the question "
    "involves litigation exposure or a debatable position.\n"
    " 18. Provide a clear DOCUMENT CHECKLIST in Section 4 — exactly "
    "what the user should keep or produce.\n"
    "\n"
    " [CONCLUSION]\n"
    " 19. End Section 7 with a clean 2-3-sentence summary — the final "
    "takeaway the user should walk away with.\n"
    " 20. If you must caveat, do it once at the end, not throughout. "
    "Don't riddle the answer with 'however', 'it depends', 'subject to' "
    "unless the caveat is material to the decision.\n"
)


# ============================================================================
# Planner execution — one tiny fast call, returns dict from JSON. Robust to
# common LLM mistakes (stray code fences, prose wrapping). Returns None on
# failure — caller must handle by proceeding without a plan.
# ============================================================================
def _run_planner(question: str) -> dict | None:
    cfg = {"temperature": 0.0, "maxOutputTokens": 512,
           "thinkingConfig": {"thinkingBudget": 0},
           "responseMimeType": "application/json"}
    base = {"systemInstruction": {"parts": [{"text": _PLANNER_SYSTEM}]},
            "generationConfig": cfg}
    contents = [{"role": "user", "parts": [{"text": question}]}]
    try:
        with _tx.gate(), httpx.Client(timeout=httpx.Timeout(20.0)) as c:
            r = c.post(_tx.url(_PLANNER_MODEL, "generateContent"),
                       headers=_tx.headers(),
                       json={**base, "contents": contents})
        if r.status_code != 200:
            log.info("planner HTTP %s — proceeding without plan", r.status_code)
            return None
        d = r.json()
        _rec_usage(_PLANNER_MODEL, d)
        cand = (d.get("candidates") or [{}])[0]
        text = "".join(p.get("text", "") for p in
                       (cand.get("content") or {}).get("parts") or []).strip()
        # Strip optional ``` fences
        if text.startswith("```"):
            text = text.strip("`").lstrip("json").strip()
        plan = json.loads(text)
        if isinstance(plan, dict):
            return plan
    except Exception as e:  # noqa: BLE001
        log.info("planner failed (%s) — proceeding without plan", e)
    return None


# ============================================================================
# Researcher execution — tool-call loop, non-streaming, returns packet text.
# ============================================================================
def _run_researcher(db: Session, question: str, *, user_id, chat_id, plan: dict | None = None) -> tuple[str, list[str], list, list]:
    """Run the researcher agent to gather evidence. Returns
    (evidence_packet_markdown, tools_used, web_sources, law_refs)."""
    tools_used: list[str] = []
    all_sources: list = []
    law_refs: list = []
    history = _recent_history(db, chat_id=chat_id, user_id=user_id)
    # Build the researcher input: user question + (optional) planner hint.
    user_text = question
    if plan and isinstance(plan, dict):
        subs = plan.get("sub_topics") or []
        core = plan.get("core_provision") or ""
        if subs or core:
            hint = "PLANNER HINT (from the planning agent — use these as a starting map for your tool calls, then expand as needed):\n"
            if core:
                hint += f"- Core provision: {core}\n"
            if subs:
                hint += "- Sub-topics to research:\n" + "\n".join(f"    * {s}" for s in subs)
            user_text = f"{question}\n\n{hint}"
    contents = history + [{"role": "user", "parts": [{"text": user_text}]}]
    # Continuation intent applies here too — if the user typed 'continue',
    # the researcher should re-fetch context for the interrupted answer.
    contents, question = _apply_continuation_intent(contents, question)

    cfg = {"temperature": 0.0, "maxOutputTokens": 1536,
           "thinkingConfig": {"thinkingBudget": 0}}
    base = {"systemInstruction": {"parts": [{"text": _RESEARCHER_SYSTEM}]},
            "tools": _TOOLS, "generationConfig": cfg}

    packet_text = ""
    for _ in range(_RESEARCHER_MAX_ITERS):
        t0 = time.time()
        try:
            with _tx.gate(), httpx.Client(timeout=httpx.Timeout(45.0)) as c:
                r = c.post(_tx.url(_RESEARCHER_MODEL, "generateContent"),
                           headers=_tx.headers(),
                           json={**base, "contents": contents})
            if r.status_code != 200:
                log.warning("researcher HTTP %s: %s", r.status_code, r.text[:150])
                break
            d = r.json()
            _rec_usage(_RESEARCHER_MODEL, d, t0)
        except Exception as e:  # noqa: BLE001
            log.warning("researcher error: %s", e)
            break
        cand = (d.get("candidates") or [{}])[0]
        parts = (cand.get("content") or {}).get("parts") or []
        # Preserve thoughtSignature alongside each functionCall — gemini-3.x
        # rejects the next turn with 400 if the echoed model turn drops it.
        fcall_parts = [p for p in parts if "functionCall" in p]
        turn_text = "".join(p.get("text", "") for p in parts).strip()

        if fcall_parts:
            # Only echo the calls we will actually respond to. Echoing an
            # ask_user call without a matching functionResponse makes Gemini
            # reject the next turn with HTTP 400 (call/response count mismatch).
            runnable = [_p for _p in fcall_parts
                        if _p["functionCall"].get("name") != "ask_user"]
            if not runnable:
                # Researcher only asked to clarify — nothing to research; use
                # whatever text it produced as the packet and stop.
                packet_text = turn_text
                break
            model_parts = []
            for _p in runnable:
                mp = {"functionCall": _p["functionCall"]}
                if _p.get("thoughtSignature"):
                    mp["thoughtSignature"] = _p["thoughtSignature"]
                model_parts.append(mp)
            contents.append({"role": "model", "parts": model_parts})
            resp_parts = []
            # Execute tool calls in parallel so a researcher iteration that
            # fires 3 searches doesn't take 3x sequential time. Each worker gets
            # its OWN DB session (_exec_tool_isolated) — the request session is
            # not thread-safe.
            import concurrent.futures as _futures
            to_run = [_p["functionCall"] for _p in runnable]
            with _futures.ThreadPoolExecutor(max_workers=max(1, len(to_run))) as pool:
                fut_map = {
                    pool.submit(
                        _exec_tool_isolated, fc.get("name"), fc.get("args") or {},
                        user_id=user_id, chat_id=chat_id,
                    ): fc for fc in to_run
                }
                for fut in _futures.as_completed(fut_map):
                    fc = fut_map[fut]
                    name = fc.get("name")
                    try:
                        res = fut.result()
                    except Exception as e:  # noqa: BLE001
                        log.warning("tool %s failed: %s", name, e)
                        res = {"error": str(e)}
                    tools_used.append(name)
                    if name in ("web_search", "search_case_law") and res.get("sources"):
                        all_sources += res["sources"]
                    if name == "search_tax_law" and res.get("passages"):
                        law_refs += [{k: p.get(k) for k in ("n", "act", "section", "breadcrumb")}
                                     for p in res["passages"]]
                    resp_parts.append({"functionResponse": {"name": name, "response": res}})
            contents.append({"role": "user", "parts": resp_parts})
            log.info("researcher iter took %.2fs (%d parallel tool calls)",
                     time.time() - t0, len(to_run))
            continue

        # No tool calls — researcher is done; the turn text is the packet.
        packet_text = turn_text
        break

    # Deduplicate web sources.
    seen, srcs = set(), []
    for s in all_sources:
        u = s.get("url")
        if u and u not in seen:
            seen.add(u)
            srcs.append(s)
    return packet_text, tools_used, srcs, law_refs


# ============================================================================
# Composer execution — non-tool, streaming answer using the packet.
# ============================================================================
import re as _re


def _self_audit(answer: str) -> str:
    """Post-generation lint pass — catches the 5-15% of leaks the prompt
    discipline still allows through. Runs on the FINAL answer text (all
    tokens streamed) and returns an appended 'Automated review notes'
    block when it finds issues, or '' when the answer is clean.

    We don't rewrite the answer (that would lose streaming trust). We
    surface the issues at the end so the reader can weight the affected
    claims accordingly.

    Rules:
      1. If the answer emits 'will apply', 'is applicable', 'highly likely
         to apply' and the same section already carries a 🔴 or 🟡 tag
         → flag as 'unhedged conclusion; verify before relying'.
      2. If a case citation appears (Party A v. Party B pattern) without
         a reporter+year, mark it 'verify citation'.
      3. If a numeric confidence >=80% is claimed while any 🔴 tag exists
         → flag inflated confidence.
      4. **CRITICAL** — if the composer reverse-engineered SDV / stamp duty
         value / guideline value / market value from Registration Fee or
         Stamp Duty Paid (dividing by an assumed %), emit a LOUD warning
         AT THE TOP of the review notes. This is the exact
         professional-feedback anti-pattern (ITO/CA cannot rely on a
         guessed rate).
    """
    if not answer or len(answer) < 200:
        return ""

    notes: list[str] = []

    # Rule 0 (goes ABSOLUTELY FIRST — worst UX) — composer bailed out
    # claiming no document was attached, when one WAS attached.
    # Signatures: 'not been attached', 'please upload', 'has not been
    # provided' near the top of the answer.
    _first_1000 = answer[:1200].lower()
    _bail_phrases = (
        "has not been attached", "not been attached", "please upload",
        "kindly upload", "once you upload", "please provide the document",
        "please provide the sale deed", "the document has not been provided",
        "without the document i cannot", "i cannot identify",
        "the sale deed document has not",
    )
    if any(p in _first_1000 for p in _bail_phrases):
        notes.append(
            "🚨 **CRITICAL — DOCUMENT-BAIL DETECTED.** The answer claims no "
            "document is attached (e.g. 'please upload the Sale Deed', 'not "
            "been attached') and then produced a generic template response "
            "instead of reading the actual attached file. This is a hard "
            "composer failure — the file text WAS in the prompt. **Discard "
            "this answer and re-ask the question.** If it persists, the "
            "attachment may have failed to index; check the document status "
            "in your library."
        )

    # Rule 4 — reverse-engineered SDV.
    # Detects patterns like:
    #   "Assuming Registration Fee of Rs 1,33,241 represents 2% of SDV"
    #   "Inferred SDV = Registration Fee / 1%"
    #   "SDV back-computed as Rs XX / 5%"
    # These are the professional-feedback red flags.
    _fee_to_sdv_patterns = [
        # 'assuming/given X = N% of SDV' or 'X represents N% of SDV'
        # Uses [^\n] (not [^.]) — Indian currency 'Rs. 1,33,241' has dots
        # that would otherwise break the middle .{0,n} spans.
        _re.compile(
            r"(?:assuming|given|since|if we treat)[^\n]{0,140}"
            r"(?:registration\s*fee|stamp\s*duty\s*paid|stamp\s*duty\s*fee)"
            r"[^\n]{0,180}(?:represents?|is|equals?|=)\s*[\d.]+\s*%"
            r"[^\n]{0,80}(?:sdv|stamp\s*duty\s*value|guideline\s*value)",
            _re.IGNORECASE | _re.DOTALL,
        ),
        # 'Inferred SDV = fee / N%' or 'SDV = X / rate' — with 'derived',
        # 'inferred', 'estimated', 'back-computed', 'implied', 'computed'
        _re.compile(
            r"(?:inferred|derived|calculated|back[- ]computed|estimated|"
            r"implied|computed)\s*(?:sdv|stamp\s*duty\s*value|guideline\s*value)"
            r"[^\n]{0,140}(?:÷|/|divided by)",
            _re.IGNORECASE,
        ),
        # 'SDV ≈ Rs XX (assuming N% rate)'
        _re.compile(
            r"(?:sdv|stamp\s*duty\s*value|guideline\s*value)\s*[≈~=]"
            r"[^\n]{0,80}\(?assum(?:ing|ed)[^\n]{0,80}\d+\s*%\s*rate",
            _re.IGNORECASE,
        ),
        # NEW anti-pattern seen 2026-08-12 incident: composer states a
        # blanket 'the registration fee is 1% of the market value / SDV'
        # rule and then divides the fee by it. This is the assumed-rate
        # premise in one sentence.
        _re.compile(
            r"(?:the\s+)?(?:registration\s*fee|stamp\s*duty(?:\s*paid)?)\s+"
            r"is\s+[\d.]+\s*%\s+of\s+(?:the\s+)?"
            r"(?:market\s*value|sdv|stamp\s*duty\s*value|guideline\s*value)",
            _re.IGNORECASE,
        ),
        # 'SDV would be Rs X / 0.01' or 'SDV = Stamp Duty / 5%' — the
        # bare-arithmetic form. Uses [^\n] (not [^.]) so 'Rs. 1,33,241.00'
        # doesn't break the match on its embedded dots.
        # v2 fix (2026-08-13): the '/' must NOT be '/-' (Indian rupee
        # suffix) and must be surrounded by numbers with whitespace.
        # Previously matched false-positive 'Rs 1,45,80,000/- ... 112%'.
        _re.compile(
            r"(?:sdv|stamp\s*duty\s*value|guideline\s*value)"
            r"[^\n]{0,60}(?:would\s+be|equals?|=)"
            r"[^\n]{0,120}(?:registration\s*fee|stamp\s*duty(?:\s*paid)?|"
            r"rs\.?\s*[\d,]+(?:\.\d+)?)"
            r"[^\n]{0,20}"
            r"(?:÷|\s/\s|\s÷\s)"     # explicit spaced / or ÷ — not /-
            r"[^\n]{0,40}(?:\d+\s*%|0\.\d+)",
            _re.IGNORECASE,
        ),
        # 'Assumed the Registration Fee ... represents N% of the SDV'
        _re.compile(
            r"(?:assumed|assuming)\s+(?:that\s+)?(?:the\s+)?"
            r"(?:registration\s*fee|stamp\s*duty(?:\s*paid)?)"
            r"[^\n]{0,180}represents?\s*[\d.]+\s*%",
            _re.IGNORECASE,
        ),
        # 'the SDV would be Rs 1,33,241.00 / 0.01' — bare-fraction form
        # Must use spaced / to avoid false positive on 'Rs X/-'
        _re.compile(
            r"the\s+(?:sdv|stamp\s*duty\s*value)\s+would\s+be"
            r"[^\n]{0,80}(?:÷|\s/\s|\s÷\s)\s*[\d.,]+",
            _re.IGNORECASE,
        ),
        # 'SDV = X / Y%' — plain equation form anywhere in the answer.
        # Catches 'Estimated SDV = Stamp Duty / 5%' variations.
        # Uses spaced / so 'Rs X/-' doesn't false-trigger.
        _re.compile(
            r"(?:sdv|stamp\s*duty\s*value|guideline\s*value)\s*(?:≈|~|=)"
            r"[^\n]{0,80}(?:÷|\s/\s|\s÷\s)\s*[\d.,]+\s*%",
            _re.IGNORECASE,
        ),
    ]
    if any(p.search(answer) for p in _fee_to_sdv_patterns):
        notes.append(
            "🚨 **CRITICAL — REVERSE-ENGINEERED VALUE DETECTED.** The answer above "
            "appears to have derived a Stamp Duty Value (or similar critical tax "
            "value) by dividing the Registration Fee or Stamp Duty Paid by an "
            "**assumed percentage rate**. Rates vary by state, asset type and "
            "year — assuming one is a professional-grade hallucination. **Discard "
            "the inferred SDV figure** and obtain the actual Stamp Valuation "
            "record from the Sub-Registrar before making any Section 50C / "
            "56(2)(x) determination. An ITO or CA relying on the guessed figure "
            "risks a demonstrably wrong assessment."
        )

    # Rule 1 — unhedged conclusions when a MATERIAL value is missing.
    # v2 fix (2026-08-12): the previous rule fired on ANY 🔴 tag in the
    # answer, which produced false positives on answers where the 🔴
    # was on ancillary fields (Witness PAN, Aadhaar, drafter details)
    # and the actual material facts (SDV, consideration, party PANs)
    # were all 🟢. That falsely told the reader to distrust a
    # correct analysis. The fix: only count 🔴 tags that appear on
    # MATERIAL fields for tax-law conclusions.
    _low = answer.lower()
    # A 🔴 counts as "material missing" only if it's on a field that
    # actually gates the SPECIFIC LEGAL CONCLUSION the composer is
    # claiming. We approximate by looking at the 60 chars BEFORE each
    # 🔴 tag.
    #
    # v3 fix (2026-08-12): narrowed the list to fields that gate
    # applicability conclusions (Sec 50C, 56(2)(x), 194-IA). Removed
    # 'cost of acquisition', 'date of transfer', 'assessment year' —
    # these are often legitimately missing (FMV-as-of-2001 not on the
    # deed, previous title's cost not on this deed) and don't
    # invalidate applicability conclusions, only computation
    # quantification. Falsely tagging them as material triggered
    # ⚠ warnings on correctly-structured answers where SDV was 🟢
    # and only cost-basis was 🔴.
    _MATERIAL_FIELDS = (
        "sdv", "stamp duty value", "stamp-duty value",
        "guideline value", "guidance value", "market value",
        "actual consideration", "sale consideration", "consideration:",
    )
    _material_missing = False
    _material_missing_positions: list[int] = []
    for _idx in range(len(answer)):
        if answer[_idx] != "🔴":
            continue
        _ctx = answer[max(0, _idx - 60):_idx].lower()
        if any(f in _ctx for f in _MATERIAL_FIELDS):
            _material_missing = True
            _material_missing_positions.append(_idx)
    # Semantic missing — phrases explicitly saying a MATERIAL value is
    # not on record. 'Witness PAN not stated' does NOT trigger this
    # (witness PAN is not a material field for tax conclusions).
    _semantic_material_missing = any(t in _low for t in (
        "sdv is not stated", "sdv is not explicitly stated",
        "stamp duty value is not stated",
        "stamp duty value is not explicitly stated",
        "guidance value is not stated", "guideline value is not stated",
        "consideration is not stated",
        "cannot be conclusively determined",
    ))
    _hard_claim_positions: list[int] = []
    for p in ("will apply", "is applicable", "clearly applicable",
              "automatically invoked", "highly likely to apply",
              "will be taxable", "will be treated as", "will attract",
              "must be adopted", "shall be deemed"):
        for m in _re.finditer(rf"\b{p}\b", answer, _re.IGNORECASE):
            _hard_claim_positions.append(m.start())
    _has_hard_claim = bool(_hard_claim_positions)
    # Proximity check: only fire when a hard claim is WITHIN ~1200 chars
    # of a material 🔴 tag. Prevents false positives where a firm
    # conclusion (e.g. 'Sec 50C is applicable' with SDV 🟢) sits far
    # from an unrelated 🔴 (e.g. 'cost of acquisition 🔴' 4000 chars
    # later in the Assumptions section).
    _claim_near_missing = False
    if _has_hard_claim and _material_missing:
        for cp in _hard_claim_positions:
            for mp in _material_missing_positions:
                if abs(cp - mp) <= 1200:
                    _claim_near_missing = True
                    break
            if _claim_near_missing:
                break
    if (_claim_near_missing or _semantic_material_missing) and _has_hard_claim:
        notes.append(
            "⚠ One or more legal conclusions above (e.g. 'will apply', "
            "'is applicable', 'clearly applicable', 'automatically invoked') "
            "should be read as CONDITIONAL — a MATERIAL fact (SDV, "
            "consideration, or similar gating value) carries a 🔴 or is "
            "flagged as not on record. The correct phrasing is 'Section X "
            "**may apply if** the missing value is confirmed'. Do not rely "
            "on the hard claim until the missing value is obtained from "
            "the official record."
        )

    # Rule 2 — case citations without a reporter+year (very loose check)
    case_pattern = _re.compile(
        r"\b(?:CIT|ITO|DCIT|PCIT|ACIT|Union of India|State of \w+|In re)\s+"
        r"v\.?\s+[A-Z][\w. &']{2,60}",
        _re.IGNORECASE,
    )
    reporter_pattern = _re.compile(
        r"\((?:19|20)\d{2}\)\s*\d+\s*(?:ITR|SCC|SCR|CTR|Taxman|"
        r"ITD|TTJ|DTR|taxmann\.com)",
        _re.IGNORECASE,
    )
    cases = case_pattern.findall(answer)
    if cases:
        # Count reporter-style citations to see if roughly one per case
        reporters = len(reporter_pattern.findall(answer))
        if reporters < len(cases):
            notes.append(
                f"⚠ Case citations appear ({len(cases)} case names, "
                f"{reporters} full reporter references). Please verify "
                "every case name against its reporter (ITR / SCC / "
                "taxmann.com etc.) before formal reliance — the AI may "
                "have named a case without the full citation string."
            )
    # Rule L-1 — Section 56(2)(x) "difference minus threshold" mis-
    # calculation. The Act says the FULL difference is taxable once
    # the threshold is breached; the threshold is a GATING test, not
    # a deduction. Composer routinely writes 'Taxable = (SDV - AC) -
    # 10% of AC' which subtracts the threshold — this is legally
    # wrong and misleads the assessee.
    # Simpler and more reliable: look for the specific arithmetic
    # 'X = Y - threshold-value = Z' where X mentions Sec 56(2)(x) /
    # taxable-under, and the subtraction takes a threshold percentage
    # off the difference. Uses [\s\S] to cross newlines.
    _sec_56_mis = _re.compile(
        r"(?:56\s*\(2\)\s*\(x\)|section\s*56[\s\S]{0,50}\(x\)|"
        r"income\s+from\s+other\s+sources|other\s+sources)"
        r"[\s\S]{0,600}?"
        r"(?:difference|excess|taxable)"
        r"[\s\S]{0,120}?"
        r"(?:minus|less|net\s+of|-|deducting)"
        r"[\s\S]{0,80}?"
        r"(?:threshold|10\s*%|tolerance|safe\s*harbour)",
        _re.IGNORECASE,
    )
    # Also the specific arithmetic pattern: "Rs X - Rs Y = Rs Z" where Y
    # is close to '10% of AC' meaning the composer subtracted the
    # threshold. This is harder to false-positive on.
    _sec_56_arith = _re.compile(
        r"(?:excess|difference)\s*(?:exceeding|over|beyond)\s*threshold\s*[:=]",
        _re.IGNORECASE,
    )
    # Fire only on the arith pattern (specific + low false positive).
    # _sec_56_mis is too loose — 'SDV - AC' triggers the '-' branch on
    # correct answers too.
    if _sec_56_arith.search(answer):
        notes.append(
            "🚨 **CRITICAL — SECTION 56(2)(x) MISCALCULATION.** The "
            "answer appears to compute the taxable amount as "
            "(SDV − Actual Consideration) MINUS the 10% / Rs 50,000 "
            "threshold. This is legally INCORRECT. The threshold is "
            "a GATING TEST, not a deduction — once the difference "
            "exceeds the threshold, the ENTIRE difference is taxable "
            "in the hands of the recipient (Purchaser). Recompute: "
            "'Taxable under Section 56(2)(x) = full (SDV − AC), NOT "
            "(SDV − AC − threshold)'. **Discard the netted figure** "
            "and use the full difference. A CA relying on the wrong "
            "figure would under-report income to the department."
        )

    # Rule 6 — Judicial-doc answer completeness. Fires when the answer
    # looks like a case-law / order analysis (contains order/judgment
    # keywords) but is missing the mandatory Case Metadata table and/or
    # the 4-category section headers.
    _looks_like_judicial_answer = (
        len(answer) > 1500
        and any(kw in _low for kw in (
            "writ petition", "cwp no", "ita no", "appeal no", "civil appeal",
            "supreme court", "high court", "itat", "tribunal held",
            "hon'ble", "judge)", "j.\n", "date of decision",
            "date of order", "pronounced on",
            "order under section", "impugned order",
        ))
    )
    if _looks_like_judicial_answer:
        _missing_j: list[str] = []
        # Metadata table probe — needs a table header row with 'field'
        # and 'value' or an explicit '## Case Metadata' heading
        if not (
            "## case metadata" in _low
            or "case metadata" in _low
            or _re.search(r"\|\s*case\s*name\s*\|", _low)
            or _re.search(r"\|\s*court\s*\|", _low)
        ):
            _missing_j.append("Case Metadata table")
        # Chronology / timeline
        if not any(kw in _low for kw in
                   ("chronology of events", "chronology", "## timeline",
                    "transaction timeline", "timeline of events",
                    "sequence of events")):
            _missing_j.append("Chronology / Timeline")
        # Findings/Ratio explicit section
        if not any(kw in _low for kw in
                   ("court's findings", "findings & ratio", "findings and ratio",
                    "ratio of the case", "held that", "the bench held",
                    "the court held")):
            _missing_j.append("Court's Findings & Ratio")
        # Model's Analysis (only nudge if opinion-type keywords are
        # present — a pure factual extraction doesn't need this)
        if _missing_j:
            notes.append(
                "ℹ️ **Judicial-document answer is missing recommended "
                "sections:** " + ", ".join(_missing_j) + ". The full "
                "assessment-ready format for a judgment/order includes: "
                "Direct Answer, Case Metadata table, Chronology of "
                "Events, Facts on the Record, Court's Findings & Ratio, "
                "Model's Analysis (if opinion), Assumptions & Missing "
                "Details, Contradictions/OCR anomalies, Overall "
                "Confidence. Re-ask with 'give me the full case brief' "
                "if you want the complete shape."
            )

    # Rule L-3 — 'fallback position: none' bail-out. Every Indian tax
    # provision has procedural remedies; asserting none exist is a
    # trust-damaging error a CA/AO will immediately spot.
    if _re.search(r"fallback\s*(?:position|option)?\s*[:\-]\s*none",
                  answer, _re.IGNORECASE):
        notes.append(
            "⚠ 'Fallback position: None' is misleading. Every Indian "
            "tax provision has a statutory remedy path — DVO reference "
            "(Sec 50C(2), Sec 55A), appeal to CIT(A) (Sec 246A), "
            "further appeal to ITAT (Sec 253/254), revision by "
            "PCIT/CIT (Sec 264/263). Please replace 'None' with the "
            "specific escalation path available on these facts."
        )

    # Rule 5 — Sale-deed answer completeness. Fires when the answer
    # looks like a Sale Deed analysis (contains deed keywords) but
    # is missing one of the mandatory sections the user's feedback
    # demanded (Timeline, Tax-Impact Matrix, Potential AO Questions,
    # Assessee Defence, Contradictions/OCR block).
    _looks_like_sale_deed_answer = (
        ("sale deed" in _low or "conveyance" in _low)
        and ("consideration" in _low)
        and ("stamp duty" in _low)
        and len(answer) > 2000  # substantial answer, not a clarification
    )
    if _looks_like_sale_deed_answer:
        _missing_sections: list[str] = []
        _section_probes = [
            ("Transaction Timeline", ("transaction timeline", "timeline (chronological)")),
            ("Tax-Impact Matrix", ("tax-impact matrix", "tax impact matrix",
                                    "tax-impact table", "vendor | purchaser")),
            ("Potential AO Questions", ("potential ao question", "ao is likely to raise",
                                        "assessing officer is likely",
                                        "questions the ao")),
            ("Assessee Defence", ("assessee defence", "assessee's defence",
                                   "vendor.*defence", "purchaser.*defence")),
        ]
        for section_name, probes in _section_probes:
            if not any(_re.search(p, _low) for p in probes):
                _missing_sections.append(section_name)
        if _missing_sections:
            notes.append(
                "ℹ️ **Sale-deed answer is missing recommended sections:** "
                + ", ".join(_missing_sections)
                + ". The full assessment-ready format includes: Document "
                "Facts, Transaction Timeline, Tax Analysis, Tax-Impact "
                "Matrix (Vendor/Purchaser), Legal Issues, Potential AO "
                "Questions, Assessee Defence, Missing Documents, "
                "Contradictions/OCR anomalies, Overall Confidence. Re-ask "
                "with 'prepare the complete assessment-ready analysis' "
                "for the full shape."
            )

    # Rule 2c — case-law-order-specific: fabricated ITA / Appeal number
    # pattern. Detects 'ITA No. 1234/[Bench]/[Year]' patterns where
    # the number looks plausibly-random but has no source anchor. We
    # can't fully verify without the doc bytes here, so we surface a
    # softer 'verify' warning whenever an ITA-No pattern appears more
    # than 3 times WITHOUT the phrase 'per the order' / 'as per the
    # attached' / 'quoting from' nearby — those anchors indicate the
    # composer is citing FROM the document rather than fabricating.
    ita_pattern = _re.compile(
        r"\b(?:ITA|Appeal|Writ)\s*(?:No\.?|Number)?\s*"
        r"\d{1,5}\s*(?:/|of)\s*(?:[A-Za-z]{2,6}\s*)?/?\s*(?:19|20)\d{2}",
        _re.IGNORECASE,
    )
    ita_matches = ita_pattern.findall(answer)
    if len(ita_matches) >= 3:
        anchored = sum(
            1 for ph in ("per the order", "as per the attached",
                         "quoting from", "the order states",
                         "impugned order", "per the impugned")
            if ph in _low
        )
        if anchored == 0:
            notes.append(
                f"⚠ {len(ita_matches)} ITA/Appeal citations appear in the "
                "answer with NO anchor phrase indicating they come from "
                "the attached document. If these citations are from "
                "general knowledge rather than the source, please verify "
                "each one against the ITAT / e-Court portal before "
                "formal reliance."
            )

    # Rule 2b — degenerate initials-only case names (e.g. 'K. R. C. S. S. S.',
    # 'S. V. S. S. V.'). Composer prompt already bans this at the source
    # (case-law hard rule B), but if it slips through it's ALWAYS a
    # hallucination — no real Indian case name is >3 consecutive single-
    # letter initials.
    initials_case_pattern = _re.compile(
        r"(?:CIT|ITO|DCIT|PCIT|ACIT)\s+v\.?\s+"
        r"(?:[A-Z]\.\s*){3,}",
        _re.IGNORECASE,
    )
    if initials_case_pattern.search(answer):
        notes.append(
            "🚨 **HALLUCINATED CASE NAME DETECTED.** The answer contains a "
            "case name that is only single-letter initials (e.g. "
            "'CIT v. K. R. C. S. S. S.'). Real Indian case names have "
            "at least one full proper noun; an initials-only string is a "
            "fabrication shape. **Do not rely on any case citation of this "
            "form in a formal submission** — verify against ITR / SCC / "
            "taxmann.com or discard it entirely."
        )

    # Rule 3 — inflated confidence when a MATERIAL 🔴 is still present.
    # v2 fix (2026-08-12): only fire if the 🔴 is on a material field
    # (uses same `_material_missing` computed above). Prevents false
    # positives on answers where the 🔴 is on ancillary fields like
    # Witness PAN.
    conf_match = _re.search(r"(?:overall confidence|confidence)\s*[:=]\s*(\d{1,3})\s*%",
                            answer, _re.IGNORECASE)
    # Same tightening as Rule 1 — only fire when the confidence claim
    # is anchored to a hard conclusion that has a nearby material 🔴.
    # If cost-of-acquisition (excluded from material fields) is 🔴 but
    # SDV / consideration are 🟢, 90%+ confidence on the Sec 50C
    # conclusion is legitimately justified.
    if conf_match and _claim_near_missing:
        pct = int(conf_match.group(1))
        if pct >= 80:
            notes.append(
                f"⚠ Stated confidence of {pct}% is inconsistent with a "
                "MATERIAL 🔴 tag near the applicable-section claim above. "
                "Real confidence should be lower — treat firm conclusions "
                "as provisional until the missing document(s) listed "
                "above are supplied."
            )

    if not notes:
        return ""
    return (
        "\n\n---\n\n### Automated review notes\n\n"
        + "\n\n".join(notes)
    )


def _classify_persona(question: str) -> tuple[str, str, int, str]:
    """Detect audience persona from question wording and return the
    (persona_id, directive_text, maxOutputTokens, model_override) 4-tuple.

    Accuracy-first (2026-08-13): all personas stay on the default
    composer model (gemini-flash-latest) — routing lay personas to a
    smaller model risks reasoning quality on tax questions. Speed comes
    from tighter maxOutputTokens + persona-specific length caps in the
    directive, which shortens output without touching reasoning depth
    per token. Model override "" means "use the default composer model".

    Length caps are calibrated against the persona test on 2026-08-12:
    founders/taxpayers glazed over on 14k-char answers; professionals
    (CA/AO) legitimately need 4k-6k words of structured analysis.
    """
    q = (question or "").lower()
    # PROFESSIONAL personas — full depth, long structured answer. Use
    # gemini-flash-latest for reasoning quality.
    if any(t in q for t in (
        "as an ao", "as the ao", "as an assessing officer",
        "as an income-tax officer", "as an income tax officer",
        "prepare an assessment", "prepare a show-cause", "prepare a notice",
        "prepare an investigation plan", "prepare an ao-risk matrix",
        "draft an assessment", "draft a show-cause", "draft an order",
        "draft grounds of appeal", "draft submission before",
        "prepare a complete case", "prepare a complete assessment",
    )):
        return ("ao", (
            "\n\n[AUDIENCE: Assessing Officer] Structure the answer for "
            "an ITO who will act on it. Lead with verification points and "
            "possible objections; include a section for evidence the "
            "department can seek; end with a summary of additions available. "
            "Length target: 2500-4000 words, exhaustive but concise. "
            "Use markdown tables freely."
        ), 6144, "")  # was 8192 — reduce to shave 20-30% output time
    if any(t in q for t in (
        "as a ca", "as the ca", "as a chartered accountant",
        "draft a reply", "draft a response", "draft an objection",
        "capital-gains computation framework", "tax audit working-paper",
        "prepare a capital-gains computation", "draft a document requisition",
    )):
        return ("ca", (
            "\n\n[AUDIENCE: Chartered Accountant / tax lawyer] Lead with "
            "the professional conclusion + risk, then the reasoning, then "
            "the drafting or computation. Give balanced Assessee-vs-Revenue "
            "arguments where relevant. Length target: 2000-3500 words."
        ), 4096, "")  # was 6144 — trim for speed
    if any(t in q for t in (
        "as a cs", "as a company secretary", "as a cfo", "as the cfo",
        "board note", "board resolution", "compliance checklist",
        "due-diligence checklist", "due diligence checklist",
        "accounting entry", "journal entries", "ledger entries",
    )):
        return ("cfo_cs", (
            "\n\n[AUDIENCE: CFO / Company Secretary] Executive style: "
            "1-paragraph verdict + risk rating, followed by an actionable "
            "checklist. Skip academic explanations of statute. "
            "Length target: 1200-2000 words. STOP at 2000 words even "
            "mid-thought."
        ), 3072, "")

    # LEARNING persona — depth OK but pedagogical.
    if any(t in q for t in (
        "as a student", "explain section", "case-study answer",
        "case study answer", "viva question", "examination-style",
        "exam-style", "for a ca examination", "step-by-step reasoning",
        "explain the concept",
    )):
        return ("student", (
            "\n\n[AUDIENCE: Student] Teach step by step. Define terms "
            "before using them. Include a worked numerical example. End "
            "with 3 viva-style questions the student should be able to "
            "answer after reading. Length target: 1500-2500 words."
        ), 4096, "")  # keep flash-latest — pedagogical depth matters

    # LAY personas — TIGHT length caps; concrete, no legalese. Keep on
    # flash-latest so short answers still reason correctly about tax law.
    if any(t in q for t in (
        "as a founder", "i am a founder", "founder", "startup",
        "for our company", "as a cto",
    )):
        return ("founder", (
            "\n\n[AUDIENCE: Founder / Business Owner] Give the answer in "
            "this exact shape and NOTHING MORE: (1) One-line direct "
            "answer. (2) 'What to do' — 3-6 concrete bullets. (3) 'Watch "
            "out for' — 2-3 pitfalls in plain English. (4) 'Documents to "
            "keep' — short checklist. (5) If any critical figure isn't in "
            "the source, say so in one sentence. NO 'Legal Analysis' "
            "block, NO 'Arguments For/Against' block, NO 'Case Law' "
            "table, NO 'Assumptions' block, NO 'Overall Confidence' "
            "line. HARD LIMIT: 600 words TOTAL. Stop at 600 words even "
            "mid-thought."
        ), 1500, "")
    if any(t in q for t in (
        "i am buying", "i am selling", "i am the buyer", "i am the seller",
        "as a buyer", "as the buyer", "as a seller", "as the seller",
        "as a taxpayer", "as the taxpayer", "what should i",
        "should i keep", "should i preserve", "what will happen if i",
        "for me as a", "for me personally",
    )):
        return ("taxpayer", (
            "\n\n[AUDIENCE: Individual taxpayer] Talk to a smart "
            "non-lawyer. STRUCTURE (do NOT deviate): (1) Direct answer "
            "(Yes/No/It depends). (2) Why in 1-2 sentences. (3) 'What "
            "to do next' — 3-5 bullets. (4) 'What to keep' — short "
            "list of docs. If a critical figure isn't in the deed, say "
            "so in ONE sentence. NO 'Legal Analysis' block, NO 'Case "
            "Law' table, NO 'Assumptions', NO 'Confidence' line. HARD "
            "LIMIT: 500 words TOTAL."
        ), 1200, "")

    # Default: PROFESSIONAL (safe fallback — full depth).
    return ("professional", (
        "\n\n[AUDIENCE: Professional (default)] Full-depth analysis. "
        "Length target: 2000-4000 words as needed by the question."
    ), 6144, "")


def _stream_composer(question: str, packet: str, history: list, plan: dict | None = None,
                     coverage_bullets: list[str] | None = None, resume_hint: str = ""):
    """Stream the composer's final answer. Yields {'delta': str} for each
    text chunk from Gemini. `history` gives conversational context for
    follow-ups; `resume_hint` (set for 'continue' turns) tells it to resume
    the prior answer rather than restart."""
    # ---------------------------------------------------------------------
    # HARD TEMPLATE ROUTER — deterministic keyword check on the raw question
    # that ALWAYS runs, even when the planner failed (e.g. HTTP 400 quota
    # spike) so we still route to the right template. Testing shows the
    # composer defaults to Template A whenever no strong signal is present
    # in the question, which makes opinion-style answers ("Analyze whether
    # ...", "Can the AO ...") read like a procedural checklist.
    # ---------------------------------------------------------------------
    q_lower = (question or "").lower()
    draft_triggers = ("draft ", "prepare a ", "prepare the ", "write a reply",
                      "write a response", "give me a draft", "draft the ",
                      "draft an ", "draft grounds", "draft submission",
                      "draft a reply", "draft a notice", "draft a show",
                      "draft a assessment", "draft an assessment")
    opinion_triggers = (
        # Explicit analytical verbs
        "analyze whether", "analyse whether", "analyze the ", "analyse the ",
        "analyze this", "analyse this", "discuss ", "evaluate whether",
        "evaluate the ", "examine whether", "examine the ",
        # Sustainability / legality
        "is it sustainable", "is the addition", "is this ",
        "legally sustainable", "sustainable in law", "legally valid",
        "legally justified", "defensible", "tenable",
        # Can/should authority... — opinion on legality of a tax authority's action
        "can the ao", "can the pcit", "can the assessing", "can he do that",
        "can an assessment", "can an addition", "can a notice", "can the ito",
        "can the department", "can the cbdt", "can the revenue",
        # Whether-clauses
        "whether the ", "whether an ", "whether a ", "whether income",
        "whether such ", "whether this ", "whether that ",
        # Should-clauses
        "should an addition", "should the ", "should i defend",
        "should we ",
        # Opinion & validity language
        "opinion on", "validity of", "grounds of appeal",
        # Solely/merely/purely — challenge to sufficiency
        "solely on", "merely on", "solely based on", "merely based on",
        "purely on the basis", "reopened solely", "sole basis",
    )
    qt = None
    if plan and isinstance(plan, dict):
        qt = plan.get("question_type")

    forced_template = None
    if any(t in q_lower for t in draft_triggers) or qt == "drafting":
        forced_template = "C"
    elif any(t in q_lower for t in opinion_triggers) or qt in ("advisory", "litigation"):
        forced_template = "B"
    elif qt in ("factual", "procedural"):
        forced_template = "A"
    log.info("template router: qt=%s forced=%s q=%r",
             qt, forced_template, (question or "")[:120])

    template_directive = ""
    if forced_template == "C":
        template_directive = (
            "\n\nFORCED TEMPLATE: **C (DRAFTING)**. This is a request to "
            "draft/prepare/write a notice, reply, submission, or appeal. "
            "Follow the Template C protocol exactly (Notice Analysis → "
            "Facts / Legal Submissions / Precedents / Prayer). Do NOT "
            "emit Template A sections (What To Do, Documents Checklist, "
            "Deadlines, Risk, Example) or Template B sections (Legal "
            "Analysis, Arguments For Assessee/Revenue, Case Law table)."
        )
    elif forced_template == "B":
        template_directive = (
            "\n\nFORCED TEMPLATE: **B (LEGAL OPINION)**. The question "
            "asks for legal reasoning / judgement about whether a "
            "position or order is defensible. Use EXACTLY the 7-section "
            "opinion flow: (un-headed opening with probability language) "
            "→ ## Legal Analysis (with a Decision Table) → ## Arguments "
            "For the Assessee → ## Arguments For the Revenue → ## Case "
            "Law (as a table with a 'Why it matters here' column) → "
            "## Opinion (prose, 4-6 sentences) → ## Next Steps. Do NOT "
            "emit any Template A sections (no 'What To Do', no "
            "'Documents Checklist', no 'Deadlines', no 'Example', no "
            "'Risk & Common Pitfalls', no 'Legal Provisions (for "
            "reference)', no 'Final Takeaway'). If those sections "
            "appear it is a routing bug — you must remove them."
        )
    elif forced_template == "A":
        template_directive = (
            "\n\nFORCED TEMPLATE: **A (CA-STYLE PRACTICAL)**. Use the "
            "practical-first flow (opening → What To Do → Example → "
            "Documents Checklist → Deadlines → Risk & Common Pitfalls "
            "→ Legal Provisions → Judicial Position → Final Takeaway). "
            "Omit any 'if applicable' section that isn't needed."
        )

    # Assemble the plan_hint prefix — only include the flag block if a
    # plan was actually produced. The template directive always runs.
    plan_hint = ""
    if plan and isinstance(plan, dict):
        parts = []
        if qt:
            parts.append(f"question_type={qt}")
        parts.append(f"needs_documents={'yes' if plan.get('needs_documents') else 'no'}")
        parts.append(f"needs_case_law={'yes' if plan.get('needs_case_law') else 'no'}")
        plan_hint = (
            "\n\nPLANNER FLAGS: " + ", ".join(parts) +
            ". If needs_documents=no, OMIT section 4 entirely. If "
            "needs_case_law=no, OMIT section 5 entirely. Do not emit "
            "placeholder text for skipped sections."
        )
        tc = (plan.get("typo_correction_applied") or "").strip()
        if tc:
            plan_hint += (
                f"\n\nTYPO CORRECTION APPLIED: {tc}. "
                "In your opening un-headed paragraph, LEAD with a brief note "
                "like 'Assuming you meant [corrected term] — ' before "
                "the verdict, so the user knows their query was interpreted. "
                "Keep it to one short clause, not a whole sentence."
            )
    plan_hint += template_directive
    # Coverage checklist — every bullet MUST be addressed in the answer.
    coverage_block = ""
    if coverage_bullets:
        coverage_block = (
            "\n\nMANDATORY COVERAGE CHECKLIST — before you finalize the "
            "answer, mentally verify that each of the following aspects is "
            "explicitly covered. If any is missing, add it (as a bullet in "
            "the relevant section, or as a new sub-heading). Do NOT skip "
            "any bullet:\n"
            + "\n".join(f"  [ ] {b}" for b in coverage_bullets)
            + "\n\nThe checklist is the acceptance criterion for the "
            "answer. A 9/10-quality answer becomes 10/10 by covering every "
            "one of these bullets in enough depth to be actionable."
        )
    # Detect audience persona from question wording so we can right-size
    # the answer. A founder or lay taxpayer asking "should I keep any
    # records?" gets a 500-word actionable brief; an AO asking for a
    # complete assessment case gets 5000-6000 words of structured
    # analysis. Same content depth, right density for the reader.
    persona, persona_directive, persona_max_tokens, persona_model = _classify_persona(question)
    composer_user_msg = (
        (f"{resume_hint}\n\n" if resume_hint else "")
        + f"USER QUESTION:\n{question}\n\n"
        + f"RESEARCH EVIDENCE PACKET (this is your source of truth — do not "
        + f"invent beyond it):\n\n{packet or '(researcher returned no packet)'}"
        + f"{plan_hint}"
        + f"{coverage_block}"
        + f"{persona_directive}"
    )
    # Prepend the conversation history so follow-ups keep context (a bare
    # "and the new regime?" must know the prior turn). Local branch also
    # bumped maxOutputTokens to 8192 so long structured Template-B/C
    # answers don't get truncated mid-table.
    contents = list(history or []) + [{"role": "user", "parts": [{"text": composer_user_msg}]}]
    # frequencyPenalty=0.3 guards against degenerate token loops. Live
    # incident 2026-08-11: composer got stuck emitting "S. V. S. S. V. "
    # repeatedly when trying to fabricate a Karnataka case citation it
    # didn't actually have — the output ran until maxOutputTokens cut it.
    # A small penalty is enough to break the loop while still allowing
    # legitimate repetition of section numbers and party names in tables.
    cfg = {"temperature": 0.0, "maxOutputTokens": persona_max_tokens,
           "frequencyPenalty": 0.3,
           "thinkingConfig": {"thinkingBudget": 0}}
    log.info("composer persona=%s max_tokens=%d model=%s q=%r",
             persona, persona_max_tokens, persona_model or "default",
             (question or "")[:80])
    base = {"systemInstruction": {"parts": [{"text": _COMPOSER_SYSTEM}]},
            "generationConfig": cfg}

    # Merged: master added the `_tx` (Vertex-ready) transport + cost-fix
    # (record cumulative usageMetadata ONCE at end). We keep those and
    # add the local branch's:
    #   * pre-flight probe + fallback model when the primary is unavailable
    #   * retry-with-backoff on transient rate-limit signals (429/503/400)
    #   * finishReason tracking + auto-continue on MAX_TOKENS or heuristic
    #     truncation (bare "##", dangling "**", empty bullet, "|" row)
    stream_finish: str | None = None
    turn_text = ""
    stream_body = {**base, "contents": contents}

    # Pick which model to actually stream from.
    # v3 optimisation: use persona-specific model when set (lay personas
    # route to gemini-flash-lite-latest for 2-3× speed). Otherwise use
    # the default composer model. If the primary model returns a hard
    # error (400/404 = model unavailable for this API key), pre-flight
    # with the fallback model instead. We can't recover partway through
    # a stream, so this pre-flight has to happen before we open the
    # streaming connection.
    stream_model = persona_model or _COMPOSER_MODEL
    if _COMPOSER_MODEL != _FALLBACK_MODEL:
        try:
            with _tx.gate(), httpx.Client(timeout=httpx.Timeout(15.0)) as _c:
                _probe = _c.post(
                    _tx.url(_COMPOSER_MODEL, "generateContent"),
                    headers=_tx.headers(),
                    json={"generationConfig": {"maxOutputTokens": 4},
                          "contents": [{"role": "user",
                                        "parts": [{"text": "ok"}]}]},
                )
            if _probe.status_code in (400, 404):
                log.warning("composer %s unavailable (HTTP %s) — using %s",
                            _COMPOSER_MODEL, _probe.status_code, _FALLBACK_MODEL)
                stream_model = _FALLBACK_MODEL
        except Exception as e:  # noqa: BLE001
            log.warning("composer probe error (%s) — falling back", e)
            stream_model = _FALLBACK_MODEL

    # Streaming call — with up to 2 retries on transient rate-limit
    # signals (HTTP 429/503 or 400 "invalid argument" that Gemini
    # returns when the per-minute quota trips). Each retry sleeps
    # progressively (2s, 5s) before re-opening the SSE connection.
    stream_started = False
    _last_usage = None  # streamGenerateContent emits usageMetadata cumulatively; keep only the last
    for _attempt, _wait in enumerate((0.0, 2.0, 5.0)):
        if _wait:
            log.info("composer stream retry %d after %.1fs (last attempt failed)",
                     _attempt, _wait)
            time.sleep(_wait)
        try:
            with _tx.gate(), httpx.Client(timeout=httpx.Timeout(120.0)) as c:
                with c.stream("POST",
                              _tx.url(stream_model, "streamGenerateContent") + "?alt=sse",
                              headers=_tx.headers(),
                              json=stream_body) as r:
                    if r.status_code != 200:
                        # Read body once for both the log and the retry decision.
                        try:
                            body_snip = r.read().decode("utf-8", "replace")[:300]
                        except Exception:  # noqa: BLE001
                            body_snip = ""
                        log.warning("composer stream HTTP %s (model=%s) body=%r",
                                    r.status_code, stream_model, body_snip)
                        retryable = (
                            r.status_code in (429, 503) or (
                                r.status_code == 400 and (
                                    "invalid argument" in body_snip.lower() or
                                    "invalid_argument" in body_snip.lower() or
                                    "rate" in body_snip.lower() or
                                    "quota" in body_snip.lower()
                                )
                            )
                        )
                        if retryable and _wait != 5.0:
                            continue  # try next attempt in the outer loop
                        # Give up — yield diagnostic and let the caller fall
                        # back to single-agent (empty-answer check does that).
                        yield {"delta": f"\n\n_(composer error {r.status_code} — please retry)_"}
                        return
                    stream_started = True
                    for line in r.iter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if not payload or payload == "[DONE]":
                            continue
                        try:
                            d = json.loads(payload)
                        except Exception:  # noqa: BLE001
                            continue
                        if d.get("usageMetadata"):
                            _last_usage = d  # keep latest; record once below
                        cand = (d.get("candidates") or [{}])[0]
                        fr = cand.get("finishReason")
                        if fr:
                            stream_finish = fr
                        for p in (cand.get("content") or {}).get("parts") or []:
                            t = p.get("text")
                            if t:
                                turn_text += t
                                yield {"delta": t}
            break  # streaming completed
        except Exception as e:  # noqa: BLE001
            log.warning("composer stream attempt %d failed: %s", _attempt, e)
            if _wait == 5.0:  # last attempt exhausted
                if not stream_started:
                    yield {"delta": f"\n\n_(streaming error: {e})_"}
                return
            continue

    # Master's cost fix — record cumulative usage ONCE at end instead of
    # per-chunk (which over-counted by ~70x).
    if _last_usage is not None:
        _rec_usage(_COMPOSER_MODEL, _last_usage)

    log.info("composer stream done: model=%s finishReason=%s chars=%d",
             stream_model, stream_finish, len(turn_text))

    # ---- Auto-continue if the answer looks truncated --------------
    # We continue on:
    #   (a) explicit MAX_TOKENS finishReason (Gemini's official signal)
    #   (b) heuristic truncation: text ends with an incomplete markdown
    #       structure — a bare "##" / "###" heading marker with no
    #       heading text after it, or a dangling "**" bold opener, or
    #       "| " / "|---" table row started but not closed, or "- "
    #       bullet with no text after. These are unmistakable signs
    #       Gemini stopped mid-token even if it reported "STOP".
    def _looks_truncated(text: str) -> bool:
        stripped = text.rstrip()
        if not stripped:
            return False
        last_line = stripped.split("\n")[-1].rstrip()
        if last_line in ("#", "##", "###", "####") or (
            last_line.startswith(("#", "##", "###", "####"))
            and last_line.replace("#", "").strip() == ""
        ):
            return True
        if last_line.endswith("**") and last_line.count("**") % 2 != 0:
            return True
        if last_line in ("-", "*", "- ", "* "):
            return True
        if last_line in ("|", "| ") or (
            last_line.startswith("|") and last_line.count("|") <= 1
        ):
            return True
        return False

    should_continue = (
        stream_finish == "MAX_TOKENS" or
        (stream_finish in (None, "OTHER") and _looks_truncated(turn_text))
    )
    if should_continue and not stream_finish == "MAX_TOKENS":
        log.info("composer: heuristic truncation detected (finishReason=%s, tail=%r) — continuing",
                 stream_finish, turn_text[-40:])

    if should_continue and turn_text.strip():
        stream_finish = "MAX_TOKENS"
        cont_contents = list(contents)
        last_piece = turn_text
        guard = 0
        while stream_finish == "MAX_TOKENS" and last_piece and guard < 4:
            guard += 1
            cont_contents.append({"role": "model", "parts": [{"text": last_piece}]})
            cont_contents.append({"role": "user", "parts": [{"text":
                "Continue the previous answer from exactly where it "
                "stopped. Do not repeat anything already written; do "
                "not re-emit any heading you already used; do not "
                "restart or recap. Just carry on and finish it."}]})
            try:
                with _tx.gate(), httpx.Client(timeout=httpx.Timeout(90.0)) as _c:
                    rc = _c.post(
                        _tx.url(stream_model, "generateContent"),
                        headers=_tx.headers(),
                        json={**base, "contents": cont_contents},
                    )
                if rc.status_code != 200:
                    log.warning("composer continue HTTP %s", rc.status_code)
                    break
                dc = rc.json()
            except Exception as e:  # noqa: BLE001
                log.warning("composer continue failed: %s", e)
                break
            cc = (dc.get("candidates") or [{}])[0]
            piece = "".join(pp.get("text", "") for pp in
                            (cc.get("content") or {}).get("parts") or [])
            if not piece:
                break
            yield {"delta": piece}
            last_piece = piece
            stream_finish = cc.get("finishReason")


# ============================================================================
# Public API — orchestration
# ============================================================================
def answer_multi_agent_stream(db: Session, question: str, *, user_id, chat_id=None, domain=None):
    """Streaming twin of the single-agent path, using the two-agent pipeline.
    Yields the same event shape as agent.answer_agentic_stream:
        {"status": ...}   — phase status (UI shows this before deltas)
        {"delta": ...}    — a text chunk for the answer
        {"done": {meta}}  — final metadata
    """
    # ---- STEP 0: deterministic typo / spelling normalisation --------------
    # Runs BEFORE the LLM planner so downstream agents see the corrected
    # question. This is instant and 100% reliable for the known typos in
    # _TYPO_DICT. Anything not in the dict falls through to the planner's
    # prompt-level rules as a soft backup.
    original_question = question
    normalised, typo_note = _normalise_query(question)
    if typo_note:
        log.info("normaliser: corrected typos in query — %s", typo_note)
        question = normalised

    # Seed the per-request token-usage sink so every sub-agent call is booked.
    usage_calls: list = []
    _usage_sink.set(usage_calls)

    # #5 (multi-agent twin) — Confidence-adjusted early exit. Same rule
    # as the fast path: if the question depends on a critical value
    # (e.g. SDV for Sec 50C) that is NOT numerically stated in the
    # attached-file text, short-circuit with a 200 ms clarification
    # instead of running the full planner + researcher + composer chain
    # and getting a low-confidence answer. Env-tunable.
    if os.getenv("EARLY_EXIT_CLARIFY", "1").lower() in ("1", "true", "yes"):
        _attached_text = _extract_attached_text(question) or ""
        if _attached_text:
            _clarify = _early_exit_clarification(question, _attached_text)
            if _clarify:
                log.info("multi-agent early-exit clarify triggered for q=%r",
                         (question or "")[:80])
                yield {"delta": _clarify}
                yield {"done": {
                    "text": _clarify,
                    "used": "early_exit_clarify",
                    "agents": ["normaliser", "early_exit"],
                    "plan": {"typo_correction_applied": typo_note or ""},
                    "coverage_bullets": [],
                    "typo_correction_applied": typo_note or "",
                    "tools_used": [],
                    "web_sources": [],
                    "law_refs": [],
                    "llm_calls": usage_calls,
                }}
                return

    yield {"status": "Planning research"}
    # Run PLANNER + COVERAGE agents in parallel — both are ~1s, so
    # concurrent execution saves ~1s vs sequential. copy_context() carries the
    # usage sink (a ContextVar) into the worker threads.
    import concurrent.futures as _futures
    # A fresh context copy per task — a single Context can't be entered by two
    # threads at once. Both copies share the same usage-sink list object.
    with _futures.ThreadPoolExecutor(max_workers=2) as _pool:
        _plan_fut = _pool.submit(contextvars.copy_context().run, _run_planner, question)
        _cov_fut = _pool.submit(contextvars.copy_context().run, _run_coverage, question)
        plan = _plan_fut.result()
        coverage = _cov_fut.result()
    # Attach the deterministic typo note to the plan (composer surfaces it).
    if plan is None:
        plan = {}
    if typo_note and not plan.get("typo_correction_applied"):
        plan["typo_correction_applied"] = typo_note
    # Merge coverage checklist: deterministic topic-specific bullets +
    # LLM-generated bullets (LLM may add question-specific aspects the
    # dict doesn't know about).
    coverage_bullets: list[str] = _match_topic_coverage(question)
    if coverage and isinstance(coverage, dict):
        for b in (coverage.get("must_cover") or []):
            if b and b not in coverage_bullets:
                coverage_bullets.append(b)

    # Landmark-case primer — deterministic case brief for known cases the
    # user asks about. Runs against the ALREADY-NORMALISED question so
    # "flipkart efos" (typo) still matches after "efos->ESOP".
    case_primer = _match_case_primer(question)

    yield {"status": "Researching primary sources"}
    # Researcher retry — when Google's per-minute quota trips, the
    # researcher call typically returns HTTP 400 immediately for the
    # first Gemini roundtrip and produces an empty packet. Waiting a
    # few seconds and re-running the researcher usually succeeds
    # (rate limits reset within ~60s). Two extra tries with 4s / 10s
    # backoff. This avoids a large fraction of the falls-through to
    # the single-agent path (which is slower and less structured).
    packet, tools_used, web_sources, law_refs = _run_researcher(
        db, question, user_id=user_id, chat_id=chat_id, plan=plan,
    )
    if not (packet or "").strip():
        for _wait in (4.0, 10.0):
            log.info("researcher empty — sleeping %.1fs and retrying", _wait)
            time.sleep(_wait)
            packet, tools_used, web_sources, law_refs = _run_researcher(
                db, question, user_id=user_id, chat_id=chat_id, plan=plan,
            )
            if (packet or "").strip():
                break
    # Prepend the landmark-case primer to the packet so the composer sees
    # authoritative material for the specific case the user asked about,
    # not just whatever an off-topic case-law search happened to return.
    if case_primer:
        log.info("matched landmark-case primer(s); prepending to packet")
        packet = case_primer + "\n\n---\n\n" + (packet or "")
    if not packet.strip():
        # Researcher returned nothing usable — fall back to the existing
        # single-agent so we never leave the user hanging.
        log.info("researcher returned empty packet; falling back to single-agent")
        yield from _single_agent.answer_agentic_stream(
            db, question, user_id=user_id, chat_id=chat_id, domain=domain,
        )
        return

    yield {"status": "Composing answer"}
    final_text = ""
    # Give the composer the conversation history (context for follow-ups), and
    # detect a 'continue' request so it RESUMES the prior answer rather than
    # restarting — the researcher handled its own continuation, but the
    # composer never saw it.
    _comp_history = _recent_history(db, chat_id=chat_id, user_id=user_id)
    _probe = _comp_history + [{"role": "user", "parts": [{"text": question}]}]
    _resolved = _apply_continuation_intent(_probe, question)[1]
    _resume_hint = _resolved if _resolved != question else ""
    for ev in _stream_composer(question, packet, history=_comp_history, plan=plan,
                               coverage_bullets=coverage_bullets, resume_hint=_resume_hint):
        if "delta" in ev:
            final_text += ev["delta"]
        yield ev

    if not final_text.strip():
        # Composer produced no usable answer — Gemini occasionally
        # returns 0-length candidates on transient errors (SAFETY block,
        # model-side race, empty tool cascade). Fall back to single-
        # agent so the user is never left with an empty response.
        log.warning("composer produced empty answer — falling back to single-agent")
        yield {"status": "Retrying via fallback agent"}
        yield from _single_agent.answer_agentic_stream(
            db, question, user_id=user_id, chat_id=chat_id, domain=domain,
        )
        return

    # Full-multi-agent path also gets LaTeX strip + self-audit — professional
    # feedback incident 2026-08-12: composer reverse-engineered SDV from
    # registration fee via BOTH paths; audit was only wired to fast-path.
    _clean_text = _strip_latex(final_text)
    if _clean_text != final_text:
        log.info("stripped LaTeX escapes from multi-agent composer output")
        final_text = _clean_text
    _audit = _self_audit(final_text)
    if _audit:
        final_text = final_text + _audit
        yield {"delta": _audit}
        log.info("multi-agent self-audit appended %d chars of review notes",
                 len(_audit))

    yield {"done": {
        "text": final_text,
        "used": "multi_agent",
        "agents": ["normaliser", "primer", "planner", "coverage", "researcher", "composer", "self_audit"],
        "plan": plan,
        "coverage_bullets": coverage_bullets,
        "typo_correction_applied": typo_note or "",
        "tools_used": tools_used,
        "web_sources": web_sources,
        "law_refs": law_refs,
        "llm_calls": usage_calls,
    }}


def answer_multi_agent(db: Session, question: str, *, user_id, chat_id=None, domain=None):
    """Non-streaming twin — collects all deltas and returns (text, meta).
    Used by the non-streaming /ask endpoint path."""
    text = ""
    meta = {"used": "multi_agent"}
    for ev in answer_multi_agent_stream(db, question, user_id=user_id,
                                        chat_id=chat_id, domain=domain):
        if "delta" in ev:
            text += ev["delta"]
        elif "done" in ev:
            meta = ev["done"]
            meta.setdefault("used", "multi_agent")
    return text, meta


def _extract_attached_text(prefixed_question: str) -> str | None:
    """The ask.py `_build_attached_context` prepends a block that
    contains BOTH the STRICT RULES prompt AND the actual document
    excerpts (in '### Attached file: name.ext' sections). We must
    extract only the document excerpts — the STRICT RULES text itself
    quotes the string `### Attached file:` as an example (in Rule 1
    and the multi-doc hint), so a naive substring search picks up the
    wrong location and returns the rules text.

    The distinguishing feature of a REAL doc section is that the
    header line is `### Attached file: <filename-with-extension>\\n`,
    while the rules-text mentions are `'### Attached file:'` (quoted,
    no real filename). We look for the header followed by an
    extension-ish filename token to disambiguate.
    """
    if not prefixed_question:
        return None
    # Anchor on the marker + a filename that contains a dot-extension.
    # The real filename is typed literally (BNS-1-00649-2021-22_ocred.pdf);
    # rules-text mentions are always quoted like `'### Attached file:' heading`.
    marker_re = _re.compile(
        r"### Attached file:\s+([^\n'\"`]{1,300}\.\w{2,6})\n",
    )
    parts: list[str] = []
    for match in marker_re.finditer(prefixed_question):
        after_header = prefixed_question[match.end():]
        # Doc chunk ends at the next "---" or "USER QUESTION:"
        stop_a = after_header.find("\n\n---\n\n")
        stop_b = after_header.find("USER QUESTION:")
        stops = [s for s in (stop_a, stop_b) if s >= 0]
        stop = min(stops) if stops else len(after_header)
        parts.append(after_header[:stop])
    if not parts:
        return None
    return "\n\n".join(parts)


def _strip_latex(text: str) -> str:
    """Safety net for the composer's occasional LaTeX slip-ups. The
    frontend markdown renderer is plain-only — it doesn't render `$$...$$`
    or `\\frac{}{}`, so those tokens land as visible source in the UI.
    Rather than adding a KaTeX dep just for the composer's misbehaviour,
    we translate common TeX to plain-text equivalents.
    """
    if not text or "$" not in text and "\\text" not in text and "\\frac" not in text:
        return text
    out = text
    # Strip \text{X} → X
    out = _re.sub(r"\\text\s*\{([^{}]*)\}", r"\1", out)
    # \frac{a}{b} → (a / b)
    out = _re.sub(r"\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"(\1 / \2)", out)
    # \times → ×, \div → ÷, \Rightarrow → →, \approx → ≈, \leq → ≤, \geq → ≥
    out = out.replace(r"\times", "×").replace(r"\div", "÷")
    out = out.replace(r"\Rightarrow", "→").replace(r"\rightarrow", "→")
    out = out.replace(r"\approx", "≈").replace(r"\leq", "≤").replace(r"\geq", "≥")
    out = out.replace(r"\%", "%").replace(r"\$", "$")
    # $$ ... $$  and  $ ... $  → strip the delimiters, keep content
    out = _re.sub(r"\$\$\s*(.*?)\s*\$\$", r"\1", out, flags=_re.DOTALL)
    out = _re.sub(r"(?<!\\)\$([^\$\n]{1,200}?)(?<!\\)\$", r"\1", out)
    return out


def _raw_user_question(prefixed_question: str) -> str:
    """The prefixed question sent to the composer includes the STRICT
    RULES prompt AND the doc excerpts before the actual user query.
    For early-exit heuristics we want the RAW user query only, so
    matches against prompt example text don't false-trigger.
    """
    if not prefixed_question:
        return ""
    marker = "USER QUESTION:"
    idx = prefixed_question.rfind(marker)
    if idx < 0:
        return prefixed_question
    return prefixed_question[idx + len(marker):].strip()


def _early_exit_clarification(question: str, attached_text: str) -> str | None:
    """Confidence-adjusted early exit — if the composer would have to
    emit MULTIPLE 🔴 tags for critical fields the user's question
    directly depends on, we short-circuit with a 2-second clarification
    request instead of a 20-second low-confidence answer.

    Returns the clarification text to emit, or None to proceed normally.

    Trigger matrix — question topic → fields that must be present:
      * Section 50C / capital gains / SDV → SDV explicitly stated
      * Section 194-IA / TDS on property → consideration + PAN
      * Section 269SS / cash payment → payment mode breakdown
      * Capital-gains computation → acquisition date + cost + consideration
    """
    if not attached_text or len(attached_text) < 200:
        return None  # too little text to judge; let composer try

    # IMPORTANT: match against the raw user question ONLY, not the
    # prefixed prompt (which contains example phrases like "If the SDV
    # is verified..." from Rule 12 that would false-trigger the
    # hypothetical-frame check below).
    q = _raw_user_question(question).lower()
    at = attached_text.lower()

    # Detect what the question is actually asking for.
    asks_sdv = any(t in q for t in (
        "section 50c", "sec 50c", "stamp duty value", "sdv",
        "guideline value", "guidance value", "50c applicable",
        "50c applicability",
    ))
    asks_capital_gain = any(t in q for t in (
        "capital gain", "capital-gain", "capital gains computation",
        "cost of acquisition", "indexation", "ltcg", "stcg",
        "long-term capital", "short-term capital",
    ))

    # Extract-side signals — has the extract text got the critical facts?
    # V2 (2026-08-12): a bare mention of "guidance value" WITHOUT a
    # numeric value is NOT sufficient. The deed BNS-1-00649 says
    # "paid as per present guidance value" but doesn't state the value
    # itself — the composer previously treated that as SDV-present and
    # then reverse-engineered a specific figure. Now we require a
    # numeric value adjacent to the SDV/GV/MV phrase.
    has_explicit_sdv = bool(_re.search(
        r"(?:stamp\s*duty\s*value|guide[\s\-]?line\s*value|"
        r"guidance\s*value|market\s*value(?:\s+(?:adopted|assessed))?|"
        r"sdv|valuation\s*adopted)"
        r"[^\n]{0,80}?"
        r"(?:rs\.?|inr|₹)\s*"
        r"([\d][\d,\.]{4,})",
        at, _re.IGNORECASE,
    ))
    # A registration/stamp fee mention alone does NOT count — we need a
    # separately-stated adopted SDV/GV/MV. This is the exact
    # reverse-engineering hazard the professional feedback flagged.
    has_acquisition_date = any(t in at for t in (
        "cost of acquisition", "acquired on", "date of acquisition",
        "purchased on", "acquired by", "cost of previous owner",
    ))

    missing: list[str] = []
    if asks_sdv and not has_explicit_sdv:
        missing.append(
            "the **Stamp Duty Value (SDV) adopted or assessable by the "
            "Sub-Registrar** — the deed you uploaded records stamp-duty "
            "paid and registration fees but does NOT state the adopted "
            "SDV in a form we can rely on. Deriving SDV from the "
            "registration fee (fee ÷ 1%) would be a reverse-engineering "
            "guess — one that a professional review would reject."
        )
    if asks_capital_gain and not has_acquisition_date:
        missing.append(
            "the **cost and date of acquisition** of the asset — the "
            "current deed captures the sale but not the prior title "
            "chain that establishes the seller's cost basis (needed for "
            "indexation under Sec 48 and for whether the gain is LTCG "
            "or STCG)."
        )

    # Only short-circuit if the question CANNOT be meaningfully answered
    # without the missing field. Founder/CFO/lay questions still get a
    # normal answer with 🔴 tags.
    if not missing:
        return None
    # Skip early exit for hypothetical-frame questions ("assume the
    # SDV is Rs 15L") — the user has explicitly supplied the missing
    # value so we should proceed.
    if any(t in q for t in ("assume ", "if the stamp duty value",
                            "suppose ", "hypothetically", "assume the")):
        return None
    # Skip early exit when the user supplied numeric values in the
    # question itself (e.g. 'what happens if I buy for ₹40L but SDV is
    # ₹50L?'). We look for TWO amount-like tokens — one is likely the
    # consideration, the other the hypothetical SDV.
    _amount_pattern = _re.compile(
        r"(?:₹|rs\.?\s*|inr\s*)?\s*\d+(?:[,\d]*)?\s*(?:lakh|crore|lac|l|cr)\b",
        _re.IGNORECASE,
    )
    _numeric_amounts = _amount_pattern.findall(q)
    if len(_numeric_amounts) >= 2:
        return None
    # Skip early exit when the question is PEDAGOGICAL (student /
    # explainer): the answer's value is teaching the concept, not
    # producing a firm figure. Same for DRAFTING — the drafted reply
    # can openly rely on hypothetical SDV.
    _pedagogical = any(t in q for t in (
        "explain", "as a student", "for a ca examination",
        "for a ca exam", "case study", "case-study", "case study answer",
        "case-study answer", "viva question", "examination-style",
        "exam-style", "step-by-step reasoning", "explain the concept",
        "walk me through", "teach me",
    ))
    _drafting = any(t in q for t in (
        "draft ", "prepare a reply", "prepare a submission",
        "write a reply", "write a response", "draft grounds",
        "draft submission", "draft an objection", "draft a notice",
    ))
    _comprehensive_report = any(t in q for t in (
        "tax-risk report", "risk report", "risk matrix",
        "complete assessment case", "complete ao investigation",
        "complete ca opinion", "act as a chartered accountant",
        "act as the assessing officer", "act as an assessing officer",
        "prepare a complete", "identify every potential",
        "identify all potential", "prepare an investigation plan",
        "framework", "checklist",
    ))
    if _pedagogical or _drafting or _comprehensive_report:
        return None

    # Show the user what WE DID extract before asking for what's missing.
    # This turns the clarification from a bare "give me X" into a value-
    # showing "here's what we found; we need X to finish".
    extracted_bits: list[str] = []
    # Consideration — look for common patterns
    _amt_re = _re.compile(
        r"(?:consideration|total consideration|sale consideration|"
        r"purchase\s*price)\s*[:=]?\s*(?:rs\.?|inr|₹)?\s*"
        r"([\d,]+(?:\.\d+)?/?-?)",
        _re.IGNORECASE,
    )
    _m = _amt_re.search(attached_text)
    if _m:
        extracted_bits.append(
            f"🟢 **Sale consideration (from deed):** Rs {_m.group(1).strip()}"
        )
    # Stamp duty paid
    _sd_re = _re.compile(
        r"(?:stamp\s*duty(?:\s*paid)?|stamp\s*duty\s*amount)\s*[:=]?\s*"
        r"(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d+)?)",
        _re.IGNORECASE,
    )
    _m = _sd_re.search(attached_text)
    if _m:
        extracted_bits.append(
            f"🟢 **Stamp duty paid (from deed):** Rs {_m.group(1).strip()}"
        )
    # Registration fee
    _rf_re = _re.compile(
        r"(?:registration\s*fee(?:s)?|reg\.\s*fee)\s*[:=]?\s*"
        r"(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d+)?)",
        _re.IGNORECASE,
    )
    _m = _rf_re.search(attached_text)
    if _m:
        extracted_bits.append(
            f"🟢 **Registration fee (from deed):** Rs {_m.group(1).strip()}"
        )
    # PAN
    _pan_re = _re.compile(r"\b([A-Z]{5}\d{4}[A-Z])\b")
    _pans = _pan_re.findall(attached_text[:8000])
    if _pans:
        extracted_bits.append(
            f"🟢 **PAN(s) found (from deed):** " + ", ".join(dict.fromkeys(_pans[:3]))
        )
    # Execution / registration date
    _date_re = _re.compile(r"\b(\d{2}[./-]\d{2}[./-]\d{4})\b")
    _dates = _date_re.findall(attached_text[:8000])
    if _dates:
        extracted_bits.append(
            f"🟢 **Dates found (from deed):** " + ", ".join(dict.fromkeys(_dates[:3]))
        )

    header = (
        "**Clarification needed before I can give a firm Section 50C answer.**\n\n"
        "Your question depends on a value that is NOT explicitly stated in "
        "the deed. To avoid a reverse-engineered guess (a professional-"
        "grade hallucination), here is a clean split of what the document "
        "does and does NOT establish:\n\n"
        "### ✅ Facts confirmed from the deed\n\n"
    )
    if not extracted_bits:
        extracted_bits.append("🟢 Document text was extracted successfully.")
    facts_block = "\n".join(extracted_bits)
    missing_block = (
        "\n\n### 🔴 Missing — required to conclude Section 50C applicability\n\n"
        + "\n".join(f"- {m}" for m in missing)
    )
    footer = (
        "\n\n### What you can do next\n\n"
        "1. **Upload the official stamp-valuation certificate or e-stamp "
        "receipt** showing the SDV — the fastest path to a firm answer, OR\n"
        "2. **Reply with the SDV explicitly** (e.g. \"assume SDV is Rs 45 "
        "lakh\") and I will run the full Section 50C / 56(2)(x) analysis "
        "against your value with a clearly-labelled 'assumption' tag, OR\n"
        "3. **Ask a narrower question I can answer from the deed alone** "
        "(e.g. \"what are the parties, PAN and consideration in this "
        "deed?\" or \"draft the capital-gains computation assuming SDV "
        "equals consideration\").\n\n"
        "*I have deliberately NOT reverse-engineered the SDV from stamp "
        "duty or registration fees — those rates vary by state/asset/year "
        "and inferring a rate is exactly the wrong approach that misled a "
        "prior version of this answer.*"
    )
    return header + facts_block + missing_block + footer


def _native_pdf_eligible(doc) -> tuple[bool, str]:
    """Return (eligible, reason) for the native-PDF fast path.

    Eligible when:
      * Feature flag NATIVE_PDF_ENABLED=1
      * File is a PDF (or image; Gemini natively reads both)
      * Under the size cap (default 15 MB / ~50 pages) — inlineData has
        a 20 MB Vertex limit per part, and very large PDFs get diluted
        attention from the model.
    """
    if os.getenv("NATIVE_PDF_ENABLED", "0").lower() not in ("1", "true", "yes"):
        return False, "flag off"
    ct = (getattr(doc, "content_type", "") or "").lower()
    is_pdf = ct == "application/pdf" or (getattr(doc, "filename", "") or "").lower().endswith(".pdf")
    is_img = ct.startswith("image/")
    if not (is_pdf or is_img):
        return False, f"content_type={ct}"
    # Size gate: enforced later against actual bytes. Assume eligible here.
    return True, "ok"


def answer_native_pdf_stream(db: Session, question: str, *, user_id, doc_ids: list[int],
                             chat_id=None, domain=None):
    """Ultra-fast path: send the PDF (or image) directly to Gemini 2.5
    flash as inline data — no PyMuPDF, no Tesseract, no per-page vision
    loop, no chunking, no embedding. Gemini reads the file natively.

    Time budget vs the current cold-path pipeline:
      * Current cold path: 60-300 s (extract + OCR + chunk + embed + Q&A)
      * Native PDF path: ~15-25 s (one Vertex call with the file inline)

    Accuracy: Gemini's native PDF reader handles Kannada/Tamil/tables/
    handwriting internally and generally outperforms the Tesseract +
    per-page-vision cascade for docs ≤50 pages. For very large corporate
    deeds (>50 pages / >15 MB) fall back to the chunk pipeline where
    retrieval matters.

    Fails open: any error (415, 429, 500, timeout) falls through to
    `answer_attached_file_stream` so the user is never left without an
    answer.
    """
    import base64
    from app.models.documents import Document as _Doc
    from app.services import storage as _st

    usage_calls: list = []
    _usage_sink.set(usage_calls)

    docs = [db.get(_Doc, d) for d in doc_ids]
    docs = [d for d in docs if d and d.owner_user_id == user_id]
    if not docs:
        log.info("native-pdf: no valid docs, falling back to fast path")
        yield from answer_attached_file_stream(
            db, question, user_id=user_id, chat_id=chat_id, domain=domain,
        )
        return

    # Size-gate every doc before we commit to this path. If any doc is
    # too large we go straight to the fast path (which handles big docs
    # via chunk retrieval).
    _MAX_INLINE = int(os.getenv("NATIVE_PDF_MAX_BYTES", str(15 * 1024 * 1024)))
    payloads: list[tuple[str, bytes, str]] = []  # (filename, bytes, mime)
    for d in docs:
        try:
            raw = _st.get_bytes(d.minio_key)
        except Exception as e:  # noqa: BLE001
            log.warning("native-pdf: cannot load %s: %s", d.filename, e)
            yield from answer_attached_file_stream(
                db, question, user_id=user_id, chat_id=chat_id, domain=domain,
            )
            return
        if len(raw) > _MAX_INLINE:
            log.info("native-pdf: %s is %d bytes > %d cap, using fast path",
                     d.filename, len(raw), _MAX_INLINE)
            yield from answer_attached_file_stream(
                db, question, user_id=user_id, chat_id=chat_id, domain=domain,
            )
            return
        mime = d.content_type or ("application/pdf"
                                  if d.filename.lower().endswith(".pdf")
                                  else "application/octet-stream")
        payloads.append((d.filename, raw, mime))

    yield {"status": "Reading document (native PDF)"}
    persona, persona_directive, persona_max_tokens, _persona_model = _classify_persona(question)

    # Build the multimodal prompt. Parts order: [pdf, pdf, …, question]
    parts: list[dict] = []
    for filename, raw, mime in payloads:
        parts.append({
            "inlineData": {"mimeType": mime,
                           "data": base64.b64encode(raw).decode("ascii")},
        })
    parts.append({
        "text": (
            f"USER QUESTION:\n{question}\n\n"
            f"The file(s) above ARE the source document(s). Answer the "
            f"question by reading them directly — extract facts verbatim, "
            f"apply Indian income-tax law. Follow the composer's evidence-"
            f"discipline rules (🟢/🟡/🔴 tags, conditional legal language, "
            f"'Missing Documents' section, 'Assumptions & Uncertainties', "
            f"'Confidence: N%' at end). Do NOT reverse-engineer critical "
            f"tax values."
            f"{persona_directive}"
        ),
    })
    contents = [{"role": "user", "parts": parts}]

    body = {
        "systemInstruction": {"parts": [{"text": _COMPOSER_SYSTEM}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": persona_max_tokens,
            "frequencyPenalty": 0.3,
            # NB: DON'T set thinkingConfig here — the model needs some
            # thinking budget to actually read the PDF pages before it
            # can answer. Auto-decide is safer.
        },
    }
    _model = os.getenv("NATIVE_PDF_MODEL", "gemini-flash-latest")
    _url = _tx.url(_model, "streamGenerateContent") + "?alt=sse"

    final_text = ""
    try:
        t0 = time.time()
        with _tx.gate(), httpx.Client(timeout=httpx.Timeout(120.0)) as c:
            with c.stream("POST", _url, headers=_tx.headers(),
                          json=body) as r:
                if r.status_code != 200:
                    body_txt = ""
                    try:
                        for chunk in r.iter_bytes():
                            body_txt += chunk.decode("utf-8", "ignore")
                            if len(body_txt) > 400:
                                break
                    except Exception:  # noqa: BLE001
                        pass
                    log.warning("native-pdf HTTP %s — falling back: %s",
                                r.status_code, body_txt[:300])
                    yield from answer_attached_file_stream(
                        db, question, user_id=user_id,
                        chat_id=chat_id, domain=domain,
                    )
                    return
                _last_um = None
                for line in r.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if not payload or payload == "[DONE]":
                        continue
                    try:
                        d = json.loads(payload)
                    except Exception:  # noqa: BLE001
                        continue
                    cand = (d.get("candidates") or [{}])[0]
                    for p in (cand.get("content") or {}).get("parts") or []:
                        if p.get("text"):
                            final_text += p["text"]
                            yield {"delta": p["text"]}
                    if d.get("usageMetadata"):
                        _last_um = d["usageMetadata"]
                if _last_um:
                    usage_calls.append({
                        "model": _model,
                        "usage": {
                            "prompt_tokens": _last_um.get("promptTokenCount"),
                            "completion_tokens": _last_um.get("candidatesTokenCount"),
                            "total_tokens": _last_um.get("totalTokenCount"),
                            "cached_tokens": _last_um.get("cachedContentTokenCount"),
                        },
                        "latency_ms": int((time.time() - t0) * 1000),
                    })
    except Exception as e:  # noqa: BLE001
        log.warning("native-pdf exception — falling back: %s", e)
        yield from answer_attached_file_stream(
            db, question, user_id=user_id, chat_id=chat_id, domain=domain,
        )
        return

    if not final_text.strip():
        log.warning("native-pdf produced empty answer — falling back")
        yield from answer_attached_file_stream(
            db, question, user_id=user_id, chat_id=chat_id, domain=domain,
        )
        return

    # Same self-audit hook as attached_file_fast.
    _audit = _self_audit(final_text)
    if _audit:
        final_text += _audit
        yield {"delta": _audit}

    yield {"done": {
        "text": final_text,
        "used": "native_pdf",
        "agents": ["native_pdf", "self_audit"],
        "plan": {"persona": persona},
        "coverage_bullets": [],
        "typo_correction_applied": "",
        "tools_used": [],
        "web_sources": [],
        "law_refs": [],
        "llm_calls": usage_calls,
    }}


def answer_attached_file_stream(db: Session, question: str, *, user_id,
                                chat_id=None, domain=None):
    """Fast path for questions that come with an attached file.

    Skips the planner + coverage + researcher stages (they add ~15-25s and
    provide no value when the primary evidence IS the attached file — its
    text is already in `question`). Streams straight from the composer.
    Yields the same event shape as `answer_multi_agent_stream`.

    Time budget: single Vertex composer call, ~5-8s to first token,
    ~15-20s to full answer. Compare with ~40-60s for the full multi-agent
    pipeline. Accuracy on attached-file questions is unaffected because
    the composer already treats the ATTACHED FILE block as first-class
    source per the _COMPOSER_SYSTEM prompt.

    Fallback: if the composer yields no text (transient safety block,
    empty candidate), we escalate to the full multi-agent pipeline so
    the user is never left with an empty answer. The extra latency in
    that error case is acceptable because it's rare.
    """
    # Seed the per-request token-usage sink for cost accounting.
    usage_calls: list = []
    _usage_sink.set(usage_calls)

    # Deterministic typo correction — cheap, safe, matches the multi-
    # agent path's Step 0. No planner classification needed.
    original_question = question
    normalised, typo_note = _normalise_query(question)
    if typo_note:
        log.info("normaliser: corrected typos in attached-file query — %s", typo_note)
        question = normalised

    yield {"status": "Reading your document"}

    # #5 — Confidence-adjusted early exit. If the question depends on a
    # critical value that is NOT in the attached-file extract (e.g. SDV
    # for Sec 50C questions), short-circuit with a 2-second clarification
    # request instead of spending 20 seconds producing a low-confidence
    # answer with reverse-engineered guesses. Gated on env flag so it
    # can be turned off if it triggers false positives on real docs.
    if os.getenv("EARLY_EXIT_CLARIFY", "1").lower() in ("1", "true", "yes"):
        _attached_text = _extract_attached_text(question) or ""
        _clarify = _early_exit_clarification(question, _attached_text)
        if _clarify:
            log.info("early-exit clarify triggered for q=%r (attached=%d chars)",
                     (question or "")[:80], len(_attached_text))
            yield {"delta": _clarify}
            yield {"done": {
                "text": _clarify,
                "used": "early_exit_clarify",
                "agents": ["normaliser", "early_exit"],
                "plan": {"typo_correction_applied": typo_note or ""},
                "coverage_bullets": [],
                "typo_correction_applied": typo_note or "",
                "tools_used": [],
                "web_sources": [],
                "law_refs": [],
                "llm_calls": usage_calls,
            }}
            return

    _comp_history = _recent_history(db, chat_id=chat_id, user_id=user_id)
    _probe = _comp_history + [{"role": "user", "parts": [{"text": question}]}]
    _resolved = _apply_continuation_intent(_probe, question)[1]
    _resume_hint = _resolved if _resolved != question else ""

    # Empty packet is deliberate — the composer prompt already handles
    # this ("If the packet is missing but the user attached a file, you
    # can still describe the file's contents from the attached text").
    # Pass a minimal plan so the composer skips packet-relevance checks
    # that assume researcher output.
    _plan = {"question_type": None,
             "needs_documents": True,
             "needs_case_law": False,
             "typo_correction_applied": typo_note or ""}
    final_text = ""
    for ev in _stream_composer(question, packet="",
                               history=_comp_history, plan=_plan,
                               coverage_bullets=[], resume_hint=_resume_hint):
        if "delta" in ev:
            final_text += ev["delta"]
        yield ev

    if not final_text.strip():
        # Rare: composer returned nothing (SAFETY block, transient race).
        # Fall back to the full multi-agent path — worst case we spend
        # the 40s we were trying to save.
        log.warning("attached-file composer produced empty answer — falling back to multi-agent")
        yield {"status": "Retrying via full pipeline"}
        yield from answer_multi_agent_stream(
            db, original_question, user_id=user_id,
            chat_id=chat_id, domain=domain,
        )
        return

    # Post-generation self-audit — catches the 5-15% of over-claims that
    # the prompt discipline still lets through (e.g. 'will apply' with a
    # 🔴 antecedent, case citation without reporter, reverse-engineered
    # SDV). We stream the note as a final delta so the user sees the
    # caveat WITH the answer. Self-audit runs on the LaTeX-stripped
    # text so pattern-matching isn't confused by TeX escapes.
    _clean_text = _strip_latex(final_text)
    if _clean_text != final_text:
        log.info("stripped LaTeX escapes from composer output")
        final_text = _clean_text
    _audit = _self_audit(final_text)
    if _audit:
        # If the audit contains a CRITICAL warning (🚨), the reader MUST
        # see it BEFORE the offending section. Prepend rather than
        # append. For non-critical ⚠ notes, appending at the end is
        # fine (the answer is trustworthy overall).
        _is_critical = "🚨" in _audit
        if _is_critical:
            # Prepend as a delta AFTER the stream — the frontend will
            # show it stitched at the top of the final message on
            # re-render. We ALSO append so streaming users see it now.
            _prepended = (
                "> ⚠️ **Read this first — automated review notes for this "
                "answer:**" + _audit + "\n\n---\n\n"
            )
            final_text = _prepended + final_text
            yield {"delta": _audit}  # streaming user gets a live tail warning
            log.info("attached-file self-audit CRITICAL — prepended %d chars",
                     len(_prepended))
        else:
            final_text = final_text + _audit
            yield {"delta": _audit}
            log.info("attached-file self-audit appended %d chars of review notes",
                     len(_audit))

    yield {"done": {
        "text": final_text,
        "used": "attached_file_fast",
        "agents": ["normaliser", "composer", "self_audit"],
        "plan": _plan,
        "coverage_bullets": [],
        "typo_correction_applied": typo_note or "",
        "tools_used": [],
        "web_sources": [],
        "law_refs": [],
        "llm_calls": usage_calls,
    }}
