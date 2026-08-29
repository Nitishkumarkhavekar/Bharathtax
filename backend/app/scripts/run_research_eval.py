"""Research-accuracy eval harness.

Runs a golden question set through the LIVE answer pipeline (the production
multi-agent path) and scores each answer DETERMINISTICALLY against expected
criteria — did it cite the right section? cover the key facts? refuse an
out-of-scope question? avoid a forbidden term? — to produce a single, repeatable
research-accuracy number you can track as the corpus/retrieval improve.

This is the objective "are we better than a generic chatbot?" signal: a generic
model can't reliably cite the correct Indian-tax section or refuse off-topic.

Run (needs the LLM + corpus configured — run on the server or with creds):
    python -m app.scripts.run_research_eval
    python -m app.scripts.run_research_eval --golden path/to/set.json --json out.json

Not part of production — kept in scripts/ for regression + quality tracking.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

DEFAULT_GOLDEN = os.path.join(os.path.dirname(__file__), "research_eval_golden.json")

_REFUSAL_SIGNALS = (
    "i can only help", "only assist with", "only help with indian income-tax",
    "outside the scope", "not able to help with that", "i'm designed to",
    "can only answer questions", "indian income-tax questions",
)


def _nospace(s: str) -> str:
    return "".join(s.split()).lower()


def _has_section(sec: str, text: str, law_refs: list) -> bool:
    s = _nospace(sec)
    if s in _nospace(text):
        return True
    for r in law_refs or []:
        if s in _nospace(str(r)):
            return True
    return False


def _looks_refused(text: str) -> bool:
    t = text.lower()
    if any(sig in t for sig in _REFUSAL_SIGNALS):
        return True
    # A tax assistant deflecting an off-topic question: short + mentions "tax"/"income-tax".
    return len(text) < 400 and ("income-tax" in t or "income tax" in t) and ("only" in t or "cannot" in t or "can't" in t)


def score_case(gold: dict, text: str, meta: dict) -> dict:
    law_refs = meta.get("law_refs") if isinstance(meta, dict) else None
    low = text.lower()

    cite_ok = all(_has_section(s, text, law_refs) for s in gold.get("cite", []))
    missing_cites = [s for s in gold.get("cite", []) if not _has_section(s, text, law_refs)]

    refuse_expected = bool(gold.get("refuse", False))
    refused = _looks_refused(text)
    refuse_ok = refused if refuse_expected else (not refused)

    mentions = gold.get("mention", [])
    hit = [m for m in mentions if _nospace(m) in _nospace(text)]
    mention_ratio = (len(hit) / len(mentions)) if mentions else 1.0

    forbid = gold.get("forbid", [])
    forbidden_hit = [f for f in forbid if f.lower() in low]
    forbid_ok = not forbidden_hit

    passed = cite_ok and refuse_ok and (mention_ratio >= 0.5) and forbid_ok
    return {
        "passed": passed, "cite_ok": cite_ok, "missing_cites": missing_cites,
        "refuse_ok": refuse_ok, "mention_ratio": round(mention_ratio, 2),
        "forbidden_hit": forbidden_hit,
    }


def run(golden_path: str, delay: float = 4.0) -> dict:
    from app.core.db import SessionLocal
    from app.services import multi_agent as _ma

    with open(golden_path, encoding="utf-8") as f:
        cases = json.load(f)["cases"]

    db = SessionLocal()
    rows, passed = [], 0
    try:
        for i, c in enumerate(cases):
            if i and delay:
                time.sleep(delay)  # pace to avoid rate-limiting the primary model
            t0 = time.time()
            text, meta = "", {}
            for ev in _ma.answer_multi_agent_stream(db, c["question"], user_id=0, chat_id=None):
                if "delta" in ev:
                    text += ev["delta"]
                elif "done" in ev:
                    meta = ev["done"]
            sc = score_case(c, text, meta)
            passed += 1 if sc["passed"] else 0
            rows.append({"id": c["id"], "topic": c.get("topic"), **sc,
                         "latency_s": round(time.time() - t0, 1)})
            mark = "PASS" if sc["passed"] else "FAIL"
            gaps = []
            if sc["missing_cites"]:
                gaps.append("no-cite:" + ",".join(sc["missing_cites"]))
            if not sc["refuse_ok"]:
                gaps.append("refuse")
            if sc["mention_ratio"] < 0.5:
                gaps.append(f"facts:{sc['mention_ratio']}")
            if sc["forbidden_hit"]:
                gaps.append("forbidden:" + ",".join(sc["forbidden_hit"]))
            sys.stderr.write(f"  [{mark}] {c['id']:<22} {c.get('topic',''):<12} {' '.join(gaps)}\n")
    finally:
        db.close()

    total = len(cases)
    return {
        "total": total, "passed": passed,
        "accuracy_pct": round(100 * passed / total, 1) if total else 0.0,
        "cite_accuracy_pct": round(100 * sum(1 for r in rows if r["cite_ok"]) / total, 1) if total else 0.0,
        "cases": rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--golden", default=DEFAULT_GOLDEN)
    ap.add_argument("--json", dest="out", default=None, help="write full results to this file")
    ap.add_argument("--delay", type=float, default=4.0,
                    help="seconds between questions (paces the primary model; 0 to disable)")
    args = ap.parse_args()

    sys.stderr.write("=" * 70 + "\n RESEARCH-ACCURACY EVAL\n" + "=" * 70 + "\n")
    res = run(args.golden, delay=args.delay)
    sys.stderr.write("-" * 70 + "\n")
    sys.stderr.write(f" ACCURACY: {res['passed']}/{res['total']} = {res['accuracy_pct']}%"
                     f"   (section-citation: {res['cite_accuracy_pct']}%)\n")
    sys.stderr.write("=" * 70 + "\n")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=2)
    else:
        json.dump(res, sys.stdout, indent=2)
    return 0 if res["accuracy_pct"] >= 80 else 1


if __name__ == "__main__":
    sys.exit(main())
