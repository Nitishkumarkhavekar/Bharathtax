"""Answer-quality test v2 — same six questions as v1 but with pacing between
runs so we stay under Vertex's per-minute RPM cap. Uses the multi-agent path
for opinion/drafting/procedural/caselaw (Template B/C benefit from the
planner + coverage passes) and the single-agent path for the fast factual/
computation ones (fewer Vertex calls each).
"""
from __future__ import annotations

import json
import sys
import time

from app.core.db import SessionLocal
from app.services import agent as _ag
from app.services import multi_agent as _ma

QUESTIONS = [
    (
        "Q1_opinion_reassessment", "opinion", "multi",
        "Just answer generally with placeholders. Provide a full legal opinion "
        "(Template B): The AO has issued a notice under Section 148A(b) for AY "
        "2019-20 alleging escapement of Rs 30 lakh from a property sale. The "
        "reasons cite Sub-Registrar information. Client filed ITR showing the "
        "transaction with a small capital loss. Notice issued after 31-Mar-2023, "
        "amount is under Rs 50 lakh, original ITR disclosed the sale, AO did not "
        "enclose underlying material. Is the reassessment sustainable? What are "
        "the strongest legal grounds to challenge it?",
    ),
    (
        "Q2_draft_sec68", "drafting", "single",
        "Just draft it generally with placeholders. Draft a complete reply "
        "(Template C) to a Section 68 notice for AY 2022-23. Assumed facts: "
        "closely-held private limited company, loans of Rs 50 lakh received "
        "from 5 parties through banking channels, all confirmations and PANs "
        "available, source-of-source explanations available per FA 2022 "
        "amendment. Produce the full draft including Analysis of Notice, "
        "Facts, Legal Submissions, Judicial Precedents, and Prayer.",
    ),
    (
        "Q3_factual_87A_new_regime", "factual", "single",
        "What is the current Section 87A rebate under the new tax regime for "
        "AY 2025-26? Include the income ceiling, the rebate amount, standard "
        "deduction, marginal-relief provision, and the current-regime slabs.",
    ),
    (
        "Q4_computation_ltcg_property", "computation", "single",
        "Compute the long-term capital gains tax for a residential property "
        "sold on 15-Oct-2024 for Rs 1.5 crore. It was acquired on 10-May-2015 "
        "for Rs 45 lakh. Assessee is a resident individual, no other income. "
        "Show old vs new regime distinction, both LTCG calculation options "
        "(12.5% flat vs 20% with indexation), surcharge, and Sec 194-IA "
        "TDS reconciliation.",
    ),
    (
        "Q5_procedural_appeal", "procedural", "single",
        "What is the complete procedure for filing an appeal before the CIT(A) "
        "against an assessment order under Section 143(3)? Include Form 35, "
        "fees, documents, timelines, powers of CIT(A) (with correct enhancement "
        "scope), Sec 249(4) pre-condition, and the JCIT(A) vs CIT(A) forum "
        "choice post-FA 2023.",
    ),
    (
        "Q6_caselaw_kelvinator", "caselaw", "single",
        "Explain the CIT vs Kelvinator of India Ltd (SC 2010) 320 ITR 561 "
        "ruling and its relevance to reassessment under Sections 147 / 148. "
        "How does it interact with post-FA-2021 Sec 148A, and with the SC "
        "transition rulings in Ashish Agarwal (2022) and Rajeev Bansal (2024)?",
    ),
]


def main() -> int:
    db = SessionLocal()
    results = {}
    try:
        for i, (qid, kind, path, q) in enumerate(QUESTIONS):
            if i > 0:
                sys.stderr.write(f"  ... cooling 30s\n"); sys.stderr.flush()
                time.sleep(30)
            t0 = time.time()
            text = ""
            meta = {}
            stream = (
                _ma.answer_multi_agent_stream if path == "multi"
                else _ag.answer_agentic_stream
            )
            for ev in stream(db, q, user_id=0, chat_id=None):
                if "delta" in ev:
                    text += ev["delta"]
                elif "done" in ev:
                    meta = ev["done"]
            dt = time.time() - t0
            # The `done.text` field is the POST-PROCESSED answer (output-
            # hygiene + citation-completion + redaction applied). This is
            # what production persists to chat_messages and what the user
            # sees rendered. Prefer it over the raw streamed deltas.
            final_text = meta.get("text") or text
            results[qid] = {
                "kind": kind,
                "path": path,
                "question": q,
                "answer": final_text,
                "answer_len_chars": len(final_text),
                "used": meta.get("used"),
                "latency_s": round(dt, 1),
                "tools_used": meta.get("tools_used", []),
                "web_sources_count": len(meta.get("web_sources", [])),
                "law_refs_count": len(meta.get("law_refs", [])),
            }
            sys.stderr.write(
                f"[{qid}] {kind:<11} {path:<6} {len(text):>5} chars  "
                f"{dt:.1f}s  used={meta.get('used')}\n"
            ); sys.stderr.flush()
    finally:
        db.close()
    json.dump(results, sys.stdout, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
