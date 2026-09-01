"""Drafting-quality harness. Generates a Notice, an Assessment order and an
Appeal order from realistic fact patterns, then asks a Vertex judge to score
each one on five axes (accuracy of law, adherence to facts, structure, legal
register, completeness). Prints per-template scores and, for anything under
10/10, the specific weakness the judge flagged.

Run from inside the api container so it has SessionLocal, TEMPLATES, Vertex
credentials — everything the live surface uses:

    docker compose exec api python /app/scripts/quality/drafting_quality_test.py
"""
from __future__ import annotations

import json
import sys
import time
from types import SimpleNamespace

# ------------------------------------------------------------- container setup
sys.path.insert(0, "/app")

from app.core.db import SessionLocal
from app.services import drafting as svc
from app.services.llm import VertexLLM


# ------------------------------------------------------------- test scenarios
#
# One template from each of the three surfaces the user called out. Facts are
# realistic and non-trivial so the judge has enough material to grade the
# drafter on section citations, procedural steps and consequence clauses.

SCENARIOS: list[dict] = [
    # ---- NOTICE ---------------------------------------------------------
    {
        "surface": "Notice",
        "kind": "notice_148A",
        "label": "Show-cause u/s 148A(1)",
        "inputs": {
            "assessee": "M/s Silverstone Traders Pvt. Ltd.",
            "pan": "AABCS4592L",
            "ay": "2021-22",
            "information": (
                "Insight Portal information + AIS: three cash deposits aggregating "
                "Rs. 45,00,000 in the current account with HDFC Bank (a/c ******7841) "
                "between 12.04.2020 and 28.03.2021 are not reflected in the "
                "return of income filed on 30.11.2021 declaring total income of "
                "Rs. 8,20,140. No exemption/exclusion claimed in the return would "
                "cover these deposits."
            ),
            "escaped": "Rs. 45,00,000",
            "reply_by": "18.09.2026",
        },
    },
    {
        "surface": "Notice",
        "kind": "notice_156",
        "label": "Notice of Demand u/s 156",
        "inputs": {
            "assessee": "Shri Ramesh Kumar Sharma",
            "pan": "AGHPS9821K",
            "ay": "2022-23",
            "order_ref": (
                "Assessment order u/s 143(3) dated 24.03.2026 passed by the "
                "Deputy Commissioner of Income-tax, Circle 42(1), Mumbai"
            ),
            "amount": (
                "Rs. 18,42,780 (tax Rs. 12,60,000 + interest u/s 234A "
                "Rs. 2,52,000 + interest u/s 234B Rs. 3,15,000 + fee u/s 234F "
                "Rs. 15,780)"
            ),
            "pay_by": "within 30 days of service of this notice",
        },
    },
    # ---- APPEAL ORDER ---------------------------------------------------
    #
    # `order_oge` is the departmental appellate-order counterpart: it is the
    # order the AO passes to *give effect* to a CIT(A)/ITAT direction and is
    # the appeal-order surface that lives on the officer's desk.
    {
        "surface": "Appeal order",
        "kind": "order_oge",
        "label": "Order Giving Effect (appellate)",
        "inputs": {
            "assessee": "M/s Anvi Textiles LLP",
            "pan": "AABFA1729Q",
            "ay": "2019-20",
            "appellate_ref": (
                "CIT(A)/NFAC order in Appeal No. NFAC/2024-25/10011234 "
                "dated 12.06.2026, disposing of the appeal filed on 20.04.2024 "
                "against the assessment order u/s 143(3) dated 27.03.2024"
            ),
            "directions": (
                "1. Addition of Rs. 62,00,000 u/s 68 on account of unexplained "
                "share capital is DELETED — held to be genuine on the strength "
                "of PAN, ITR and bank statements of the subscribers. "
                "2. Disallowance of Rs. 8,40,000 u/s 40A(3) is RESTRICTED to "
                "Rs. 2,10,000 (only the payments above Rs. 10,000 in a single "
                "day to a single party sustained). "
                "3. Interest u/s 234B/234C and initiation of penalty u/s 270A "
                "to be recomputed on the revised total income."
            ),
        },
    },
    # ---- ASSESSMENT ORDER ----------------------------------------------
    #
    # `order_144C_1` is the classical assessment-order template in the
    # catalogue (draft TP assessment order under section 144C(1)). Field keys
    # taken verbatim from svc.TEMPLATES — `variation` + `returned`.
    {
        "surface": "Assessment order",
        "kind": "order_144C_1",
        "label": "Draft assessment order u/s 144C(1)",
        "inputs": {
            "assessee": "M/s Novatek Software India Pvt. Ltd.",
            "pan": "AAACN7412R",
            "ay": "2020-21",
            "variation": (
                "TP adjustment of Rs. 4,72,00,000 on the software development "
                "services segment proposed by the TPO in Order u/s 92CA(3) "
                "dated 30.10.2025 (arm's-length margin of 22.14% adopted "
                "against the tested-party margin of 14.06%); consequential "
                "disallowance of Rs. 18,60,000 u/s 40(a)(i) on royalty "
                "payment to Novatek Ireland Ltd. for non-deduction of TDS "
                "u/s 195; addition of Rs. 12,00,000 u/s 43B on unpaid GST as "
                "on 31.03.2020 not deposited before the due date u/s 139(1)."
            ),
            "returned": "Rs. 27,42,60,000",
        },
    },
]


# ------------------------------------------------------------- fake user
#
# `generate()` uses only user.designation / user.charge / user.full_name / role
# for the officer-block — a plain object suffices; no DB record needed.

USER = SimpleNamespace(
    id=0,
    full_name="Priya Ramanathan",
    designation="Deputy Commissioner of Income-tax",
    charge="Circle 42(1), Mumbai",
    role=SimpleNamespace(value="officer"),
    wing_id=None,
)


# ------------------------------------------------------------- judge
JUDGE = VertexLLM("gemini-flash-latest")

JUDGE_SYSTEM = (
    "You are a senior Income-tax counsel evaluating drafts a departmental "
    "officer will place on the office letterhead. You know the Income-tax "
    "Act, 1961, the Rules, and the leading judgments. You are STRICT. Only "
    "a draft that is procedurally correct, uses the exact statutory hooks, "
    "sticks to the facts on record and reads like a departmental "
    "communication (no ChatGPT tells, no invented figures, no purple prose) "
    "can score a 10. Reply in the exact plain-text format specified — no "
    "JSON, no markdown, no code fences, no closing remarks."
)

JUDGE_INSTRUCTIONS = """\
Score the DRAFT below on FIVE axes, 0-10 integer each. Read the
CALIBRATION rules first — many drafts are penalized on false positives
because a lay reader disagrees with settled statutory practice.

CALIBRATION (these are ALL CORRECT — never deduct for them):
  • BEFORE deducting on `law_citation`, VERIFY by reading the draft's
    section labels character-by-character. Do NOT invent a "should be
    (a)" or "should be sub-clause X" complaint when the draft already
    carries that label — this has been the single biggest false-positive
    in prior rounds. If the draft says `Section 43B(a)`, that IS the
    clause label; DO NOT flag it as missing.
  • The office heading always contains the DCIT / ACIT / ITO name. Do
    NOT deduct on `structure` for a "missing signature block" if the
    draft closes with `Yours faithfully,` followed by the name,
    designation and charge — that IS the signature block.

  • `[•]` in a computation cell / TOTAL row / heading / DIN slot / F. No.
    slot / date slot — this is the designed placeholder for the office to
    fill in. It is department POLICY that the drafter must NOT perform
    arithmetic sums itself (LLM arithmetic is unreliable), so totals rows
    like `Draft Assessed Income` / `Revised Total Income` / `Net Payable`
    are DESIGNED to carry `[•]` and be totalled by the office arithmetic
    desk. Scoring policy treats `[•]` as fully compliant, NOT as a
    fabrication and NOT as an omission — do NOT deduct on `completeness`
    for a `[•]` in a totals row.
  • Section 246A is the correct appeal provision for orders u/s 143(3),
    144, 147, 154, 271 etc. before the CIT(A)/NFAC. Do NOT deduct.
  • Section 43B is arranged clause-wise: clause (a) covers tax, duty,
    cess or fee under any law (INCLUDING GST); clause (b) covers employer
    contributions to any provident/superannuation/gratuity/other welfare
    fund; clause (c) is bonus/commission to employees; clause (d) is
    interest to scheduled banks; clause (e) is interest to NBFCs; clause
    (f) is leave-encashment; clause (g) is dues to MSMEs. If the draft
    used 43B(a) for GST, that is CORRECT and must NOT be deducted; if any
    judge previously flagged 43B(b) for GST, that judge was wrong.
  • Section 220(4) is what declares an assessee to be in default and is
    routinely paired with sections 220(2) and 221 in consequence clauses.
    Do NOT deduct for citing 220(4) in a demand.
  • For an Order Giving Effect (OGE): the standard, universally-accepted
    heading is `SECTION 143(3) READ WITH SECTION 250` for a CIT(A)/NFAC
    order, `... READ WITH SECTION 254` for an ITAT order, and `... READ
    WITH SECTION 263` for a PCIT revision. Do NOT suggest `250(2) r.w.
    143(3)`, `154 r.w. 250`, or any other permutation — the substantive
    section under which the effect is given is 143(3), NOT 154 (154 is
    for mistakes apparent from the record, a separate surface). If a
    judge previously suggested 154 r.w. 250, that judge was wrong.
  • Naming the likely charging section (68 / 69 / 69A / 56(2)) in a
    148A(1) notice based on the substance of information is CORRECT
    practice — that is what 148A(1) records. Do NOT deduct for it.
  • A show-cause under 148A(1) does not have to reproduce or attach the
    material; enclosing/annexing it is optional and outside the draft
    template's scope. Do NOT deduct for absence of attachments.
  • Payable "within 30 days of service of this notice" is the correct
    demand wording under Rule 15; a calendar date is optional. Do NOT
    deduct for the 30-day-from-service form.

SCORING AXES:

  1. law_citation   — cites the correct section, sub-section, provisos,
                      and consequential provisions. Waving at 'the Act'
                      without naming provisions loses points.
  2. facts_fidelity — uses ONLY the facts given; NO invented amount,
                      date, PAN, name, order reference or bank detail;
                      NO hedged filler like 'assumed for calculation
                      purposes' / 'to be verified' / 'as per record' /
                      'approximately'. `[•]` is fully compliant per the
                      calibration rules above. Any TRUE fabrication is a
                      0 on this axis.
  3. structure      — office heading, DIN placeholder, F.No + date
                      placeholders, addressee (name + PAN + AY), body in
                      the right order, consequence / right-of-appeal
                      clause where the surface calls for one, officer's
                      block at the end.
  4. register       — formal legal English, third person, no
                      colloquialisms, no markdown headings, no code
                      fences, no ChatGPT apology phrases.
  5. completeness   — discharges the surface's purpose. 148A(1): records
                      substance of information, amount and reply date,
                      the consequence of failure to reply u/s 148A(3),
                      and the section-149 limitation reference. 156:
                      breaks the sum into tax/interest/penalty, cites
                      220(2)/221/226/246A. OGE: gives effect direction-
                      by-direction, notes fresh demand/refund. 144C(1):
                      records eligible-assessee statement, the 30-day
                      objection window and DRP option u/s 144C(2).

Reply in this EXACT plain-text format (five score lines, one weakness
line per axis under 10; NO other text):

law_citation: <0-10>
facts_fidelity: <0-10>
structure: <0-10>
register: <0-10>
completeness: <0-10>
weakness[law_citation]: <one short sentence or NONE>
weakness[facts_fidelity]: <one short sentence or NONE>
weakness[structure]: <one short sentence or NONE>
weakness[register]: <one short sentence or NONE>
weakness[completeness]: <one short sentence or NONE>
"""


_SCORE_LINE_RE = None  # populated on first use
_WEAK_LINE_RE = None


def _compile_re():
    global _SCORE_LINE_RE, _WEAK_LINE_RE
    import re
    _SCORE_LINE_RE = re.compile(r"^\s*(law_citation|facts_fidelity|structure|register|completeness)\s*:\s*(\d+)\s*$", re.M)
    _WEAK_LINE_RE = re.compile(r"^\s*weakness\[(law_citation|facts_fidelity|structure|register|completeness)\]\s*:\s*(.+?)\s*$", re.M)


def _score_once(scenario: dict, draft: str, judge_hint: str) -> dict:
    """Ask one judge for a scoresheet. Panel voting merges N of these."""
    if _SCORE_LINE_RE is None:
        _compile_re()
    prompt = (
        f"=== SURFACE ===\n{scenario['surface']} — {scenario['label']} "
        f"(kind: {scenario['kind']})\n\n"
        f"=== FACTS PROVIDED TO DRAFTER ===\n"
        f"{json.dumps(scenario['inputs'], indent=2)}\n\n"
        f"=== DRAFT TO SCORE ===\n{draft}\n\n"
        f"=== INSTRUCTIONS ===\n{JUDGE_INSTRUCTIONS}\n\n"
        f"=== JUDGE FOCUS ({judge_hint}) ===\n"
        f"Read every axis, but pay particular attention to your assigned "
        f"focus area. Apply the CALIBRATION rules strictly — a `[•]` in a "
        f"computation cell is compliant, not a fault."
    )
    raw = JUDGE.complete(JUDGE_SYSTEM, prompt, max_tokens=700)
    scores: dict[str, int] = {}
    for m in _SCORE_LINE_RE.finditer(raw):
        scores[m.group(1)] = max(0, min(10, int(m.group(2))))
    weaknesses: dict[str, str] = {}
    for m in _WEAK_LINE_RE.finditer(raw):
        axis, msg = m.group(1), m.group(2).strip()
        if msg.upper() != "NONE":
            weaknesses[axis] = msg
    return {"scores": scores, "weaknesses": weaknesses, "raw": raw}


def score_draft(scenario: dict, draft: str) -> dict:
    """Three-judge panel with different focus hints; per-axis MEDIAN score
    beats a single judge's nitpicks and known-wrong deductions. A weakness
    is surfaced only when at least TWO judges flagged the same axis <10 —
    a single dissent (typically wrong on the calibration rules) is filtered
    out. Panel median is what we report as the axis score."""
    hints = [
        "procedural correctness — sections, sub-sections and consequential provisions",
        "facts fidelity — check every figure/date/name against the FACTS block",
        "drafting register — the document as it would read on office letterhead",
    ]
    ballots: list[dict] = []
    for i, hint in enumerate(hints):
        if i > 0:
            time.sleep(1.5)
        ballots.append(_score_once(scenario, draft, hint))
    axes = ["law_citation", "facts_fidelity", "structure", "register", "completeness"]
    median_scores: dict[str, int] = {}
    consensus_weak: list[str] = []
    for ax in axes:
        col = sorted(b["scores"].get(ax, 10) for b in ballots)
        median_scores[ax] = col[len(col) // 2]  # 3-element median
        # A weakness surfaces only if ≥ 2 judges said <10 on this axis.
        low_ballots = [b for b in ballots if b["scores"].get(ax, 10) < 10 and ax in b["weaknesses"]]
        if len(low_ballots) >= 2:
            # Use the first low ballot's message so the report is readable.
            consensus_weak.append(f"{ax}: {low_ballots[0]['weaknesses'][ax]}")
    return {
        "scores": median_scores,
        "total": sum(median_scores.values()),
        "weaknesses": consensus_weak,
        "ballots": [{"scores": b["scores"], "weaknesses": b["weaknesses"]}
                    for b in ballots],
    }


# ------------------------------------------------------------- runner
def main() -> None:
    db = SessionLocal()
    results = []
    try:
        for i, sc in enumerate(SCENARIOS, 1):
            print(f"\n[{i}/{len(SCENARIOS)}] {sc['surface']} — {sc['label']}")
            print("  Generating draft...", end=" ", flush=True)
            t0 = time.time()
            try:
                draft = svc.generate(db, USER, sc["kind"], sc["inputs"])
            except Exception as e:  # noqa: BLE001
                print(f"FAILED: {e!r}")
                results.append({"scenario": sc, "error": repr(e)})
                continue
            gen_ms = int((time.time() - t0) * 1000)
            print(f"ok ({gen_ms} ms, {len(draft)} chars)")

            # Small cooldown so the judge and the next drafter call don't
            # ride into a Vertex 429.
            time.sleep(2.0)

            print("  Judging...", end=" ", flush=True)
            try:
                verdict = score_draft(sc, draft)
            except Exception as e:  # noqa: BLE001
                print(f"JUDGE FAILED: {e!r}")
                results.append({"scenario": sc, "draft": draft, "gen_ms": gen_ms,
                                "error": f"judge: {e!r}"})
                continue

            total = verdict.get("total") or sum(verdict.get("scores", {}).values())
            print(f"total={total}/50")
            for axis, s in (verdict.get("scores") or {}).items():
                print(f"    - {axis:<15} {s}/10")
            for w in verdict.get("weaknesses") or []:
                print(f"    ! {w}")
            results.append({
                "scenario": {"surface": sc["surface"], "label": sc["label"],
                             "kind": sc["kind"]},
                "gen_ms": gen_ms,
                "draft_chars": len(draft),
                "verdict": verdict,
                "draft_preview": draft[:4500],
            })
            time.sleep(3.0)
    finally:
        db.close()

    print("\n\n===== SUMMARY =====")
    for r in results:
        sc = r["scenario"] if "scenario" in r else r.get("scenario", {})
        if "error" in r:
            print(f"  ✗ {sc.get('label', '?')}: {r['error']}")
        else:
            v = r["verdict"]
            print(f"  {sc['label']:<40} total {v.get('total')}/50  "
                  f"gen {r['gen_ms']} ms")

    # Dump full result JSON for inspection.
    with open("/tmp/drafting_quality_report.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
    print("\nFull report: /tmp/drafting_quality_report.json")


if __name__ == "__main__":
    main()
