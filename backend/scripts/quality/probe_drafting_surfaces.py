"""Live QUALITY probe for BharathTax's drafting COMPOSER agent.

Fires 13 realistic AO-side + assessee-side drafting asks across every
`QUALITY_SCHEMA` surface at `VertexLLM('gemini-2.5-flash').complete(
    _COMPOSER_SYSTEM, question, max_tokens=1400)` and scores each output /10.

Rules
-----
* -2  if the answer contains any deflection phrase (scope refusal).
* -2  if the surface is officer-side (notice-*, assessment-*) but the
      answer leaks the Template C "Strengths of Department's Case /
      Weaknesses / Chance of Success / Final Takeaway" scaffold instead
      of using Template D (issue a document).
* -1  for each expected key phrase missing (case-insensitive).
* clamp to [0, 10].

Run inside the api container:
  MSYS_NO_PATHCONV=1 docker exec taxmedha-api-1 \
      python //app/scripts/quality/probe_drafting_surfaces.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, "/app")

from app.services.multi_agent import _COMPOSER_SYSTEM  # noqa: E402
from app.services.llm import VertexLLM  # noqa: E402


# ---------------------------------------------------------------------------
# Corpus — one question per QUALITY_SCHEMA surface (13 rows). Biased toward
# realistic AO-side drafting asks with concrete facts (AY, amounts, sections).
# ---------------------------------------------------------------------------
CORPUS: list[dict[str, str]] = [
    {
        "surface": "notice-142-1",
        "question": (
            "Draft a Notice u/s 142(1) of the Income-tax Act, 1961 to be "
            "issued to M/s Anand Traders (PAN AABCA1234K) for AY 2023-24, "
            "calling for particulars of cash deposits of Rs 38,50,000 into "
            "current account no. 000123456789 with HDFC Bank, Chandni Chowk "
            "branch, between 01-04-2022 and 31-03-2023. Ask for the source "
            "of cash, cash book, bank statement, sales register, party-wise "
            "ledgers and copies of returns filed. Compliance date: 15 days."
        ),
    },
    {
        "surface": "notice-143-2",
        "question": (
            "Draft a Notice u/s 143(2) of the Income-tax Act, 1961 for "
            "limited scrutiny of Shri Rakesh Kumar (PAN ABCPK9876Q), AY "
            "2023-24, on the CASS reason 'Large increase in sundry "
            "creditors compared to preceding year'. E-proceeding to be "
            "faceless; state the DIN placeholder and compliance date."
        ),
    },
    {
        "surface": "notice-148A-1",
        "question": (
            "Draft a show-cause notice u/s 148A(1) (formerly 148A(b)) of "
            "the Income-tax Act, 1961 for AY 2021-22 in respect of M/s "
            "Sunrise Enterprises (PAN AAAFS1122L). Insight portal reveals "
            "aggregate cash deposits of Rs 45,00,000 in SBI SB a/c during "
            "FY 2020-21 that do not match the return filed. Attach the "
            "material relied upon and give 7 days to reply. Include the "
            "specified-authority approval reference u/s 151."
        ),
    },
    {
        "surface": "notice-156-demand",
        "question": (
            "Draft a Notice of Demand u/s 156 of the Income-tax Act, 1961 "
            "consequent to an assessment order u/s 143(3) for AY 2022-23 "
            "in the case of Shri Aman Verma (PAN ABIPV5551M). Tax demand "
            "Rs 8,42,310, interest u/s 234A Rs 12,900, interest u/s 234B "
            "Rs 68,450, interest u/s 234C Rs 4,120. Payment within 30 "
            "days at the specified BSR / challan route, with warning of "
            "recovery u/s 220(4) and 221(1) on default."
        ),
    },
    {
        "surface": "notice-226-3-garnishee",
        "question": (
            "Draft a garnishee notice u/s 226(3) of the Income-tax Act, "
            "1961 to ICICI Bank Ltd, Connaught Place branch, in respect "
            "of M/s Delta Metals Pvt Ltd (PAN AACCD3344P), directing the "
            "bank to pay over Rs 27,80,000 held in the assessee's current "
            "account to the credit of the Central Government against the "
            "outstanding demand for AY 2019-20."
        ),
    },
    {
        "surface": "notice-271AAC-penalty",
        "question": (
            "Draft a penalty show-cause notice u/s 271AAC(1) read with "
            "Section 274 of the Income-tax Act, 1961 in the case of Shri "
            "Prakash Jain (PAN ABPPJ2233K), AY 2022-23, where an addition "
            "of Rs 22,00,000 has been sustained u/s 68 as unexplained cash "
            "credit and taxed u/s 115BBE. Give 15 days for reply and "
            "opportunity of personal hearing."
        ),
    },
    {
        "surface": "notice-133-6",
        "question": (
            "Draft a Notice u/s 133(6) of the Income-tax Act, 1961 to "
            "Kotak Mahindra Bank Ltd, Andheri West branch, calling for "
            "certified copies of the account opening form, KYC documents, "
            "monthly statements from 01-04-2020 to 31-03-2023, and "
            "specimen signature of M/s Bright Traders (PAN AACFB7788J), "
            "with 10 days' compliance."
        ),
    },
    {
        "surface": "appeal-oge",
        "question": (
            "Draft an Order Giving Effect (OGE) to the CIT(A)'s appellate "
            "order dated 12-06-2024 in the case of M/s Zenith Realtors "
            "(PAN AAACZ4455L), AY 2020-21. The CIT(A) has deleted an "
            "addition of Rs 62,00,000 made u/s 68 on unexplained share "
            "capital and restricted a Section 40A(3) disallowance from "
            "Rs 18,40,000 to Rs 3,20,000. Recompute total income, tax, "
            "interest u/s 234A/B/C, and issue revised demand / refund."
        ),
    },
    {
        "surface": "appeal-263-revision",
        "question": (
            "Draft a show-cause notice u/s 263 of the Income-tax Act, "
            "1961 by the PCIT proposing to revise the assessment order "
            "u/s 143(3) dated 28-09-2023 for AY 2021-22 in the case of "
            "M/s Orion Infratech (PAN AAACO6677N), on the ground that "
            "the AO allowed a Section 80-IA deduction of Rs 4,15,00,000 "
            "without verifying the audit report in Form 10CCB and "
            "eligibility conditions — order therefore erroneous and "
            "prejudicial to the interests of the revenue."
        ),
    },
    {
        "surface": "appeal-cita-hearing",
        "question": (
            "Draft the assessee's written submissions for the CIT(A) "
            "hearing scheduled on 05-10-2024 in Appeal No. CIT(A)-Delhi-"
            "17/10234/2023-24, filed against the assessment order u/s "
            "143(3) dated 25-03-2023 for AY 2020-21 in the case of Shri "
            "Karan Malhotra (PAN AJHPM8890R). Grounds: (i) addition of "
            "Rs 19,25,000 u/s 68 for cash deposits during "
            "demonetisation, (ii) disallowance of Rs 4,60,000 u/s "
            "36(1)(iii) on interest-free advances. Cite Nemi Chand "
            "Kothari, S A Builders and CIT vs Reliance Utilities."
        ),
    },
    {
        "surface": "assessment-144C-1",
        "question": (
            "Draft a Draft Assessment Order u/s 144C(1) of the Income-tax "
            "Act, 1961 in the case of M/s Global Tech Services Pvt Ltd "
            "(PAN AABCG9911R) — an eligible assessee — for AY 2021-22. "
            "The TPO's order dated 30-07-2024 proposes a transfer pricing "
            "adjustment of Rs 4,72,00,000 to the ALP of software "
            "development services rendered to the AE. Set out the "
            "variation, invite objections before the DRP or acceptance "
            "before the AO within 30 days u/s 144C(2)."
        ),
    },
    {
        "surface": "assessment-143-3-order",
        "question": (
            "Draft a final assessment order u/s 143(3) read with Section "
            "144B for AY 2022-23 in the case of M/s Meridian Textiles "
            "Pvt Ltd (PAN AAACM2244F). Additions: Rs 34,50,000 u/s 68 on "
            "unexplained share application money; Rs 6,20,000 u/s 14A r/w "
            "Rule 8D; Rs 2,80,000 u/s 40(a)(ia) for non-deduction of TDS. "
            "Compute total income, tax, interest u/s 234A/B/C, initiate "
            "penalty u/s 270A, and issue notice of demand u/s 156."
        ),
    },
    {
        "surface": "assessment-154-rectification",
        "question": (
            "Draft an order u/s 154 of the Income-tax Act, 1961 "
            "rectifying the intimation u/s 143(1) dated 18-11-2023 for "
            "AY 2023-24 in the case of Smt Neha Agarwal (PAN AHRPA6543C). "
            "TDS credit of Rs 47,860 reflected in Form 26AS was not "
            "granted by CPC; interest u/s 234B was also miscomputed. Give "
            "credit, recompute tax and interest, and issue revised "
            "demand / refund intimation."
        ),
    },
]


# ---------------------------------------------------------------------------
# Scoring rules
# ---------------------------------------------------------------------------
DEFLECT_RE = re.compile(
    r"(strictly limited|expertise is (?:strictly )?limited"
    r"|only.{0,20}income-tax"
    r"|cannot provide.{0,15}(?:GST|advice|analysis))",
    re.I,
)

# Template C = the analytical "chances of success" scaffold. Leaks onto
# officer-side drafts when the composer picks the wrong template.
TEMPLATE_C_MARKERS = (
    "Strengths of Department's Case",
    "Weaknesses / Assessee's Defensible Grounds",
    "Chance of Success",
    "Final Takeaway",
)

# Expected key phrases per surface (case-insensitive). Missing => -1 each.
EXPECTED_PHRASES: dict[str, list[str]] = {
    "notice-142-1": [
        "Section 142(1)",
        "Income-tax Act, 1961",
        "Assessment Year",
        "produce",
        "Yours faithfully",
    ],
    "notice-143-2": [
        "Section 143(2)",
        "Income-tax Act, 1961",
        "scrutiny",
        "DIN",
        "Yours faithfully",
    ],
    "notice-148A-1": [
        "Section 148A(1)",
        "Section 151",
        "specified authority",
        "show cause",
        "Yours faithfully",
    ],
    "notice-156-demand": [
        "Section 156",
        "Notice of Demand",
        "30 days",
        "Section 220(2)",
        "Section 221",
    ],
    "notice-226-3-garnishee": [
        "Section 226(3)",
        "outstanding demand",
        "Central Government",
        "personally liable",
        "Yours faithfully",
    ],
    "notice-271AAC-penalty": [
        "Section 271AAC",
        "Section 274",
        "Section 115BBE",
        "show cause",
        "opportunity of being heard",
    ],
    "notice-133-6": [
        "Section 133(6)",
        "Income-tax Act, 1961",
        "furnish",
        "certified",
        "Yours faithfully",
    ],
    "appeal-oge": [
        "Order Giving Effect",
        "CIT(A)",
        "total income",
        "Section 234B",
        "Section 156",
    ],
    "appeal-263-revision": [
        "Section 263",
        "erroneous",
        "prejudicial to the interests of the revenue",
        "show cause",
        "Principal Commissioner",
    ],
    "appeal-cita-hearing": [
        "CIT(A)",
        "Section 250",
        "Ground",
        "Section 68",
        "written submissions",
    ],
    "assessment-144C-1": [
        "Section 144C(1)",
        "eligible assessee",
        "Dispute Resolution Panel",
        "transfer pricing",
        "30 days",
    ],
    "assessment-143-3-order": [
        "Section 143(3)",
        "Section 144B",
        "Section 156",
        "Section 270A",
        "total income",
    ],
    "assessment-154-rectification": [
        "Section 154",
        "mistake apparent",
        "Section 143(1)",
        "Form 26AS",
        "rectified",
    ],
}


OFFICER_SURFACES = {
    s for s in EXPECTED_PHRASES if s.startswith("notice-") or s.startswith("assessment-")
}


def score_answer(surface: str, question: str, ans: str) -> dict[str, Any]:
    issues: list[str] = []
    strengths: list[str] = []
    score = 10

    # 1. deflection
    m = DEFLECT_RE.search(ans)
    if m:
        score -= 2
        issues.append(f"scope-deflection: matched '{m.group(0)[:60]}'")
    else:
        strengths.append("no scope deflection")

    # 2. Template C leakage on officer-side surfaces
    if surface in OFFICER_SURFACES:
        leaks = [mk for mk in TEMPLATE_C_MARKERS if mk.lower() in ans.lower()]
        if leaks:
            score -= 2
            issues.append(
                "Template C leakage on officer-side draft: "
                + ", ".join(leaks)
            )
        else:
            strengths.append("uses Template D (document draft), no Template C leak")

    # 3. expected key phrases
    lc = ans.lower()
    missing: list[str] = []
    present: list[str] = []
    for phrase in EXPECTED_PHRASES.get(surface, []):
        if phrase.lower() in lc:
            present.append(phrase)
        else:
            missing.append(phrase)
    if missing:
        score -= len(missing)
        issues.append("missing expected phrases: " + "; ".join(missing))
    if present:
        strengths.append("hit expected phrases: " + ", ".join(present))

    # clamp
    score = max(0, min(10, score))

    return {
        "surface": surface,
        "question": question,
        "score_10": score,
        "issues": issues,
        "strengths": strengths,
        "answer_preview": ans[:600],
    }


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def main() -> int:
    llm = VertexLLM("gemini-2.5-flash")
    per_surface: list[dict[str, Any]] = []

    for idx, row in enumerate(CORPUS):
        surface = row["surface"]
        question = row["question"]
        print(f"\n===== {surface} =====", flush=True)
        # Pace to avoid the Vertex per-minute quota (429). Skip on first call.
        if idx > 0:
            time.sleep(20)
        ans: str | None = None
        last_exc: Exception | None = None
        # Retry with exponential backoff specifically for 429 / transient errors.
        for attempt in range(1, 6):
            try:
                ans = llm.complete(_COMPOSER_SYSTEM, question, max_tokens=1400)
                break
            except httpx.HTTPStatusError as exc:
                last_exc = exc
                status = exc.response.status_code
                if status not in (429, 500, 502, 503, 504):
                    break
                backoff = min(60, 15 * attempt)
                print(
                    f"  attempt {attempt} got HTTP {status}; sleeping {backoff}s and retrying",
                    flush=True,
                )
                time.sleep(backoff)
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                backoff = min(60, 10 * attempt)
                print(
                    f"  attempt {attempt} raised {exc!r}; sleeping {backoff}s and retrying",
                    flush=True,
                )
                time.sleep(backoff)
        if ans is None:
            if last_exc is not None:
                traceback.print_exception(type(last_exc), last_exc, last_exc.__traceback__)
            per_surface.append({
                "surface": surface,
                "question": question,
                "score_10": 0,
                "issues": [f"LLM error after retries: {last_exc!r}"],
                "strengths": [],
                "answer_preview": "",
            })
            continue
        scored = score_answer(surface, question, ans)
        per_surface.append(scored)
        print(f"score: {scored['score_10']}/10", flush=True)
        for iss in scored["issues"]:
            print("  ISSUE  :", iss, flush=True)
        for st in scored["strengths"]:
            print("  STRENGTH:", st, flush=True)
        print("--- preview ---", flush=True)
        print(scored["answer_preview"], flush=True)

    total = sum(r["score_10"] for r in per_surface)
    avg = round(total / max(1, len(per_surface)), 2)

    # Common faults = issue-strings appearing on >=3 surfaces
    fault_counts: dict[str, int] = {}
    for r in per_surface:
        seen: set[str] = set()
        for iss in r["issues"]:
            head = iss.split(":", 1)[0].strip()
            if head not in seen:
                fault_counts[head] = fault_counts.get(head, 0) + 1
                seen.add(head)
    common_faults = [f for f, c in fault_counts.items() if c >= 3]

    scoreboard = {
        "total": total,
        "avg_score_10": avg,
        "per_surface": per_surface,
        "common_faults": common_faults,
    }

    print("\n\n=========== SCOREBOARD (JSON) ===========")
    print(json.dumps(scoreboard, indent=2, ensure_ascii=False))

    out_path = Path("/app/scripts/quality/drafting_probe_results.json")
    out_path.write_text(json.dumps(scoreboard, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
