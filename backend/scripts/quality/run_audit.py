"""Audit runner: quality, injection, coverage.

Run inside the api container:
  docker exec taxmedha-api-1 python /app/scripts/quality/run_audit.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import traceback

sys.path.insert(0, "/app")

from app.services.multi_agent import _COMPOSER_SYSTEM
from app.services.llm import VertexLLM
from app.services import prompt_guard

QUALITY_PATH = "/app/scripts/quality/audit_quality.json"
INJECTION_PATH = "/app/scripts/quality/audit_injection.json"
COVERAGE_PATH = "/app/scripts/quality/audit_coverage.json"
RAW_PATH = "/app/scripts/quality/audit_results.json"


def _load(p: str) -> dict:
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


DEFLECTION_PATTERNS = [
    r"strictly limited",
    r"expertise is limited",
    r"only.{0,30}income-tax",
    r"cannot provide.{0,20}GST",
    r"out of scope",
    r"outside my scope",
    r"not equipped",
    r"refer to a GST expert",
]
DEFLECT_RE = re.compile("|".join(DEFLECTION_PATTERNS), re.IGNORECASE)


def score_quality(ans: str, must_contain: list, must_not_contain: list) -> dict:
    lo = (ans or "").lower()
    missing = [s for s in must_contain if s.lower() not in lo]
    forbidden_hit = [s for s in must_not_contain if s.lower() in lo]
    score = 10 - len(missing) - 2 * len(forbidden_hit)
    if score < 0:
        score = 0
    if score > 10:
        score = 10
    return {
        "score_10": int(score),
        "missing": missing,
        "forbidden_hit": forbidden_hit,
    }


def run_quality(llm: VertexLLM) -> dict:
    data = _load(QUALITY_PATH)
    questions = data.get("questions", [])
    per_question = []
    raw = []
    passed = 0
    total_score = 0
    for q in questions:
        qid = q["id"]
        question = q["question"]
        mc = q.get("must_contain", [])
        mnc = q.get("must_not_contain", [])
        try:
            ans = llm.complete(_COMPOSER_SYSTEM, question, max_tokens=900)
        except Exception as e:
            ans = ""
            err = f"LLM error: {e!r}"
            print(f"[QUAL {qid}] {err}", flush=True)
            raw.append({"id": qid, "question": question, "answer": "", "error": err})
            per_question.append({
                "id": qid,
                "score_10": 0,
                "missing": mc,
                "forbidden_hit": [],
            })
            continue
        s = score_quality(ans, mc, mnc)
        per_question.append({"id": qid, **s})
        total_score += s["score_10"]
        if s["score_10"] >= 8 and not s["forbidden_hit"]:
            passed += 1
        raw.append({
            "id": qid,
            "question": question,
            "answer": ans,
            "score_10": s["score_10"],
            "missing": s["missing"],
            "forbidden_hit": s["forbidden_hit"],
        })
        print(f"[QUAL {qid}] score={s['score_10']}/10 missing={len(s['missing'])} forbidden={len(s['forbidden_hit'])}",
              flush=True)
    total = len(questions)
    avg = round(total_score / total, 2) if total else 0.0
    return {
        "summary": {
            "total": total,
            "passed": passed,
            "avg_score_over_10": avg,
            "per_question": per_question,
        },
        "raw": raw,
    }


def run_injection() -> dict:
    data = _load(INJECTION_PATH)
    payloads = data.get("payloads", [])
    correct = 0
    attacks = 0
    attacks_blocked = 0
    benigns = 0
    benign_false_blocks = 0
    failures = []
    raw = []
    for p in payloads:
        pid = p["id"]
        family = p.get("family", "")
        payload = p["payload"]
        expect = p["expect"]
        try:
            blocked = bool(prompt_guard.looks_like_meta_exfiltration(payload))
        except Exception as e:
            blocked = False
            print(f"[INJ {pid}] guard error: {e!r}", flush=True)
        got = "block" if blocked else "allow"
        ok = (blocked and expect == "block") or (not blocked and expect == "allow")
        if expect == "block":
            attacks += 1
            if blocked:
                attacks_blocked += 1
        else:
            benigns += 1
            if blocked:
                benign_false_blocks += 1
        if ok:
            correct += 1
        else:
            failures.append({
                "id": pid,
                "family": family,
                "expected": expect,
                "got": got,
                "payload": payload,
            })
        raw.append({
            "id": pid,
            "family": family,
            "payload": payload,
            "expected": expect,
            "got": got,
            "correct": ok,
        })
        print(f"[INJ {pid}] expect={expect} got={got} ok={ok}", flush=True)
    total = len(payloads)
    br = round(attacks_blocked / attacks, 4) if attacks else 0.0
    fp = round(benign_false_blocks / benigns, 4) if benigns else 0.0
    return {
        "summary": {
            "total": total,
            "correct": correct,
            "block_rate_on_attacks": br,
            "false_positive_rate_on_benign": fp,
            "failures": failures,
        },
        "raw": raw,
    }


def run_coverage(llm: VertexLLM) -> dict:
    data = _load(COVERAGE_PATH)
    items = data.get("coverage", [])
    per_regime_map: dict = {}
    substantive = 0
    deflected = 0
    raw = []
    for it in items:
        qid = it["id"]
        regime = it.get("regime", "unknown")
        question = it["question"]
        per_regime_map.setdefault(regime, {"regime": regime, "ok": 0, "fail": 0})
        try:
            ans = llm.complete(_COMPOSER_SYSTEM, question, max_tokens=900)
        except Exception as e:
            ans = ""
            print(f"[COV {qid}] LLM error: {e!r}", flush=True)
        ans_text = ans or ""
        deflect_match = DEFLECT_RE.search(ans_text)
        is_deflect = bool(deflect_match)
        is_substantive = (len(ans_text) >= 800) and not is_deflect
        if is_substantive:
            substantive += 1
            per_regime_map[regime]["ok"] += 1
        else:
            per_regime_map[regime]["fail"] += 1
        if is_deflect:
            deflected += 1
        raw.append({
            "id": qid,
            "regime": regime,
            "question": question,
            "answer": ans_text,
            "length": len(ans_text),
            "deflected": is_deflect,
            "deflect_match": deflect_match.group(0) if deflect_match else None,
            "substantive": is_substantive,
        })
        print(f"[COV {qid}] regime={regime} len={len(ans_text)} deflect={is_deflect} substantive={is_substantive}",
              flush=True)
    total = len(items)
    per_regime = list(per_regime_map.values())
    return {
        "summary": {
            "total": total,
            "substantive": substantive,
            "deflected": deflected,
            "per_regime": per_regime,
        },
        "raw": raw,
    }


def main() -> None:
    llm = VertexLLM("gemini-2.5-flash")

    print("== QUALITY ==", flush=True)
    q = run_quality(llm)
    print("== INJECTION ==", flush=True)
    i = run_injection()
    print("== COVERAGE ==", flush=True)
    c = run_coverage(llm)

    scoreboard = {
        "quality": q["summary"],
        "injection": i["summary"],
        "coverage": c["summary"],
    }
    raw_all = {
        "quality": q["raw"],
        "injection": i["raw"],
        "coverage": c["raw"],
        "scoreboard": scoreboard,
    }
    with open(RAW_PATH, "w", encoding="utf-8") as f:
        json.dump(raw_all, f, ensure_ascii=False, indent=2)
    # Emit the scoreboard on stdout as a clearly-fenced block so the caller
    # can extract it deterministically.
    print("\n=====SCOREBOARD_JSON_BEGIN=====", flush=True)
    print(json.dumps(scoreboard, ensure_ascii=False, indent=2), flush=True)
    print("=====SCOREBOARD_JSON_END=====", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
