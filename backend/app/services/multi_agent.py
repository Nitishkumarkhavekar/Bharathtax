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
_KEY = _single_agent._KEY
_BASE = _single_agent._BASE
_TOOLS = _single_agent._TOOLS
_TOOL_STATUS = _single_agent._TOOL_STATUS
_exec_tool = _single_agent._exec_tool
_recent_history = _single_agent._recent_history
_apply_continuation_intent = _single_agent._apply_continuation_intent

# --- SPEED TUNING ---------------------------------------------------------
# Each agent runs on the tier that fits its job:
#   - Planner   → fastest tier (tiny prompt, JSON out) — flash-lite
#   - Researcher→ fast tier (tool-call loop) — flash-lite by default
#   - Composer  → higher-quality tier (streams user-facing prose) — flash
# All three overridable via env.
_PLANNER_MODEL = os.getenv(
    "MULTI_AGENT_PLANNER_MODEL",
    os.getenv("GEMINI_JSON_MODELS", "gemini-flash-lite-latest").split(",")[0].strip()
    or "gemini-flash-lite-latest",
)
_RESEARCHER_MODEL = os.getenv(
    "MULTI_AGENT_RESEARCHER_MODEL",
    os.getenv("GEMINI_JSON_MODELS", "gemini-flash-lite-latest").split(",")[0].strip()
    or "gemini-flash-lite-latest",
)
_COMPOSER_MODEL = os.getenv(
    "MULTI_AGENT_COMPOSER_MODEL",
    _single_agent._MODEL,  # default: whatever the single agent uses
)
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
        "## PRIMER: Flipkart ESOP Case (from BharathTax curated case index)\n"
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
        "## PRIMER: Infosys ESOP Case (from BharathTax curated case index)\n"
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
        "## PRIMER: Vodafone Case (from BharathTax curated case index)\n"
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
        "## PRIMER: Biocon ESOP Case (from BharathTax curated case index)\n"
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
        "## PRIMER: Lovely Exports Case (from BharathTax curated case index)\n"
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
        "## PRIMER: Kelvinator Case (from BharathTax curated case index)\n"
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
        "## PRIMER: GKN Driveshafts Case (from BharathTax curated index)\n"
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
        "## PRIMER: NRA Iron & Steel Case (from BharathTax curated index)\n"
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
        bool(_KEY)
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
    "You are BharathTax's PLANNER agent. Given the user's tax question, "
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
    "You are BharathTax's COVERAGE agent. Given a tax question, return "
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
        with httpx.Client(timeout=httpx.Timeout(20.0)) as c:
            r = c.post(f"{_BASE}/{_PLANNER_MODEL}:generateContent",
                       headers={"x-goog-api-key": _KEY,
                                "Content-Type": "application/json"},
                       json={**base, "contents": contents})
        if r.status_code != 200:
            log.info("coverage HTTP %s — proceeding without checklist", r.status_code)
            return None
        d = r.json()
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
    "You are BharathTax's RESEARCH agent. Your ONLY job is to gather every "
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
    "  (1) the user's question, and\n"
    "  (2) a research evidence packet already gathered by the research "
    "agent (statutes, cases, cross-references, thresholds, regime notes).\n"
    "\n"
    "Your job: write the final answer for the user using ONLY the "
    "evidence in the packet. Do NOT invent Sections, Rules, or "
    "citations that are not in the packet. If the packet is silent on a "
    "point, say so — do not fabricate.\n"
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
    "OPEN with a direct 2-3 sentence verdict paragraph. CRITICAL: this "
    "opening paragraph has NO HEADING. Do NOT emit '## 1. Short Answer', "
    "'Short Answer', '## Short Answer', or any label above it — just the "
    "plain paragraph. The heading numbering below starts from '## 2' — "
    "the opening verdict is un-headed. Never open with 'It depends on', "
    "'Determining X requires', 'There are several factors', or any "
    "hedging preamble.\n"
    "\n"
    "USE THIS TEMPLATE (exact H2 headings, in this order, starting from "
    "'## 2'). SECTIONS 4 AND 5 ARE OPTIONAL — you MUST OMIT the heading "
    "entirely (do NOT emit the '## 4. Documents / Evidence' line at all) "
    "if the packet doesn't call for documents. Same for '## 5. Judicial "
    "Position' when the packet has no on-point case law. NEVER write "
    "placeholders like 'No specific documents required', 'No on-point "
    "case law provided', 'None on point', 'N/A' — just SKIP the heading "
    "and move to the next section number. The section numbering you emit "
    "does NOT need to be contiguous — if you skip section 4, jump from 3 "
    "to 5; if you skip 4 and 5, jump from 3 to 6. Sections 2, 3, 6, 7 "
    "are always required.\n"
    "\n"
    "(un-headed opening)             — 2-3 sentence verdict / bottom line. NO HEADING.\n"
    "## 2. Relevant Law              — Section(s), Rule(s), Circulars from packet.\n"
    "## 3. Legal Analysis\n"
    "   ### Facts Considered         — assumed / stated facts.\n"
    "   ### Conditions               — statutory requirements + formula.\n"
    "   ### Exceptions               — provisos + old-vs-new regime under Sec 115BAC.\n"
    "   ### Practical Implications   — worked mechanic + related compliance.\n"
    "## 4. Documents / Evidence      (if applicable)\n"
    "## 5. Judicial Position         (if applicable — only on-point cases from packet)\n"
    "## 6. Recommended Next Steps    — 3-7 concrete actions.\n"
    "## 7. Final Conclusion          — one paragraph 'so what'.\n"
    "\n"
    "STYLE: markdown headings, tight bullets, Indian number format "
    "(Rs 1,50,000 or Rs 1.5 lakh), Section names cited explicitly on "
    "first use (e.g. 'Section 80C of the Income-tax Act, 1961'), regime "
    "distinction called out UP FRONT in Legal Analysis when applicable. "
    "Never emit an empty table. Never write 'consult a professional' — "
    "give concrete next steps."
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
        with httpx.Client(timeout=httpx.Timeout(20.0)) as c:
            r = c.post(f"{_BASE}/{_PLANNER_MODEL}:generateContent",
                       headers={"x-goog-api-key": _KEY,
                                "Content-Type": "application/json"},
                       json={**base, "contents": contents})
        if r.status_code != 200:
            log.info("planner HTTP %s — proceeding without plan", r.status_code)
            return None
        d = r.json()
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
            with httpx.Client(timeout=httpx.Timeout(45.0)) as c:
                r = c.post(f"{_BASE}/{_RESEARCHER_MODEL}:generateContent",
                           headers={"x-goog-api-key": _KEY,
                                    "Content-Type": "application/json"},
                           json={**base, "contents": contents})
            if r.status_code != 200:
                log.warning("researcher HTTP %s: %s", r.status_code, r.text[:150])
                break
            d = r.json()
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
            model_parts = []
            for _p in fcall_parts:
                mp = {"functionCall": _p["functionCall"]}
                if _p.get("thoughtSignature"):
                    mp["thoughtSignature"] = _p["thoughtSignature"]
                model_parts.append(mp)
            contents.append({"role": "model", "parts": model_parts})
            resp_parts = []
            # Execute tool calls in parallel so a researcher iteration that
            # fires 3 searches doesn't take 3x sequential time.
            import concurrent.futures as _futures
            to_run = [_p["functionCall"] for _p in fcall_parts
                      if _p["functionCall"].get("name") != "ask_user"]
            with _futures.ThreadPoolExecutor(max_workers=max(1, len(to_run))) as pool:
                fut_map = {
                    pool.submit(
                        _exec_tool, fc.get("name"), fc.get("args") or {},
                        db=db, user_id=user_id, chat_id=chat_id,
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
def _stream_composer(question: str, packet: str, history: list, plan: dict | None = None,
                     coverage_bullets: list[str] | None = None):
    """Stream the composer's final answer. Yields {'delta': str} for each
    text chunk from Gemini."""
    plan_hint = ""
    if plan and isinstance(plan, dict):
        parts = []
        qt = plan.get("question_type")
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
        # Surface the typo correction if the normaliser (or planner) flagged one.
        tc = (plan.get("typo_correction_applied") or "").strip()
        if tc:
            plan_hint += (
                f"\n\nTYPO CORRECTION APPLIED: {tc}. "
                "In your opening un-headed paragraph, LEAD with a brief note "
                "like 'Assuming you meant [corrected term] — ' before "
                "the verdict, so the user knows their query was interpreted. "
                "Keep it to one short clause, not a whole sentence."
            )
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
    composer_user_msg = (
        f"USER QUESTION:\n{question}\n\n"
        f"RESEARCH EVIDENCE PACKET (this is your source of truth — do not "
        f"invent beyond it):\n\n{packet or '(researcher returned no packet)'}"
        f"{plan_hint}"
        f"{coverage_block}"
    )
    contents = [{"role": "user", "parts": [{"text": composer_user_msg}]}]
    cfg = {"temperature": 0.0, "maxOutputTokens": 4096,
           "thinkingConfig": {"thinkingBudget": 0}}
    base = {"systemInstruction": {"parts": [{"text": _COMPOSER_SYSTEM}]},
            "generationConfig": cfg}

    try:
        with httpx.Client(timeout=httpx.Timeout(120.0)) as c:
            with c.stream("POST",
                          f"{_BASE}/{_COMPOSER_MODEL}:streamGenerateContent?alt=sse",
                          headers={"x-goog-api-key": _KEY,
                                   "Content-Type": "application/json"},
                          json={**base, "contents": contents}) as r:
                if r.status_code != 200:
                    log.warning("composer HTTP %s", r.status_code)
                    yield {"delta": "\n\n_(composer error — falling back)_"}
                    return
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
                        t = p.get("text")
                        if t:
                            yield {"delta": t}
    except Exception as e:  # noqa: BLE001
        log.warning("composer stream failed: %s", e)
        yield {"delta": f"\n\n_(streaming error: {e})_"}


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

    yield {"status": "Planning research"}
    # Run PLANNER + COVERAGE agents in parallel — both are ~1s, so
    # concurrent execution saves ~1s vs sequential.
    import concurrent.futures as _futures
    with _futures.ThreadPoolExecutor(max_workers=2) as _pool:
        _plan_fut = _pool.submit(_run_planner, question)
        _cov_fut = _pool.submit(_run_coverage, question)
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
    packet, tools_used, web_sources, law_refs = _run_researcher(
        db, question, user_id=user_id, chat_id=chat_id, plan=plan,
    )
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
    for ev in _stream_composer(question, packet, history=[], plan=plan,
                               coverage_bullets=coverage_bullets):
        if "delta" in ev:
            final_text += ev["delta"]
        yield ev

    yield {"done": {
        "text": final_text,
        "used": "multi_agent",
        "agents": ["normaliser", "primer", "planner", "coverage", "researcher", "composer"],
        "plan": plan,
        "coverage_bullets": coverage_bullets,
        "typo_correction_applied": typo_note or "",
        "tools_used": tools_used,
        "web_sources": web_sources,
        "law_refs": law_refs,
        "llm_calls": [],
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
