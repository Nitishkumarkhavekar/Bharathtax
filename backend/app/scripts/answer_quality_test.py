"""Answer-quality test harness.

Runs a curated set of real tax questions through the production multi-agent
Vertex pipeline and dumps the answers to a JSON file for the judge agent to
score. Not part of production — kept in `scripts/` for regression testing.

Usage (inside the api container):
  python -m app.scripts.answer_quality_test > /tmp/answers.json
"""
from __future__ import annotations

import json
import sys
import time

from app.core.db import SessionLocal
from app.services import multi_agent as _ma

QUESTIONS = [
    (
        "Q1_opinion_reassessment",
        "opinion",
        "The AO has issued a notice under Section 148A(b) for AY 2019-20 alleging "
        "escapement of Rs 30 lakh from a property sale. The reasons cite information "
        "from the Sub-Registrar's office. My client filed ITR showing the transaction "
        "correctly with a small capital loss. Is the reassessment sustainable? "
        "What are the strongest legal grounds to challenge it?",
    ),
    (
        "Q2_draft_sec68",
        "drafting",
        "Draft a reply to a Section 68 notice for AY 2022-23. The AO alleges that "
        "unsecured loans of Rs 50 lakh received from 5 parties are unexplained cash "
        "credits. My client is a closely-held private limited company. All loans were "
        "received through banking channels and confirmations are available.",
    ),
    (
        "Q3_factual_87A_new_regime",
        "factual",
        "What is the current Section 87A rebate under the new tax regime for AY 2025-26? "
        "Include the income ceiling, the rebate amount, and whether the marginal-relief "
        "provision applies.",
    ),
    (
        "Q4_computation_ltcg_property",
        "computation",
        "Compute the long-term capital gains tax for a residential property sold on "
        "15-Oct-2024 for Rs 1.5 crore. It was acquired on 10-May-2015 for Rs 45 lakh. "
        "Assessee is a resident individual. Please show old vs new regime distinction "
        "and post-23-Jul-2024 vs pre changes.",
    ),
    (
        "Q5_procedural_appeal",
        "procedural",
        "What is the complete procedure for filing an appeal before the CIT(A) against "
        "an assessment order under Section 143(3)? Include the form number, fees, "
        "documents required, timelines, and the powers of the CIT(A).",
    ),
    (
        "Q6_caselaw_kelvinator",
        "caselaw",
        "Explain the CIT v. Kelvinator of India Ltd (SC 2010) ruling and its relevance "
        "to reassessment proceedings under Section 147 / 148. How is it applied by "
        "the Department vs by assessees today?",
    ),
]


def main() -> int:
    db = SessionLocal()
    results = {}
    try:
        for qid, kind, q in QUESTIONS:
            t0 = time.time()
            text = ""
            meta = {}
            for ev in _ma.answer_multi_agent_stream(
                db, q, user_id=0, chat_id=None,
            ):
                if "delta" in ev:
                    text += ev["delta"]
                elif "done" in ev:
                    meta = ev["done"]
            dt = time.time() - t0
            results[qid] = {
                "kind": kind,
                "question": q,
                "answer": text,
                "answer_len_chars": len(text),
                "used": meta.get("used"),
                "latency_s": round(dt, 1),
                "tools_used": meta.get("tools_used", []),
                "web_sources_count": len(meta.get("web_sources", [])),
                "law_refs_count": len(meta.get("law_refs", [])),
            }
            sys.stderr.write(f"[{qid}] {kind:<12} {len(text):>5} chars  {dt:.1f}s  used={meta.get('used')}\n")
    finally:
        db.close()
    json.dump(results, sys.stdout, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
