"""BharathTax — 10-round x 79-question instrumented benchmark across all versions.

For every prompt it records:
  user_tokens      : tokens in the user's question
  chunk_tokens      : tokens of retrieved context actually sent (after truncation)
  chunk_tokens_full : tokens of the full untruncated chunks
  chunk_used_pct    : chunk_tokens / chunk_tokens_full  (how much of the chunk is used)
  prompt_tokens     : total prompt tokens (system+question+context) from vLLM usage
  generated_tokens  : completion tokens from vLLM usage
  complete/incomplete chunks : a chunk is "incomplete" if it was truncated (len>cap)
  retrieval hit     : was the question's source provision retrieved (under its version)
Plus system CPU impact sampled throughout (4 cores).

Questions are generated from the corpus itself (random distinct provisions across
all 4 versions) so labels are known and every version is exercised.
Token counts come from vLLM /tokenize; gen usage from the chat response.
"""
from __future__ import annotations

import json
import random
import threading
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import psutil

import rag_core

ROUNDS = 10
PER_ROUND = 79
CONCURRENCY = 4
TOK_URL = rag_core.LLM.rsplit("/v1", 1)[0] + "/tokenize"
OUT = rag_core.DATA.parent / "benchmark_report.json"

TEMPLATES = [
    "What does {lbl} {sec} of the {act} deal with?",
    "Explain the provisions of {lbl} {sec} of the {act}.",
    "What is provided under {lbl} {sec}?",
    "Summarise {lbl} {sec} of the {act}.",
    "Under {lbl} {sec}, what does the law say?",
]


def _post(url, payload, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def ntok(text: str) -> int:
    try:
        return _post(TOK_URL, {"model": rag_core.LLM_MODEL, "prompt": text})["count"]
    except Exception:
        return max(1, len(text) // 4)


def build_questions(store) -> list[dict]:
    # distinct (version, section/rule) section-level provisions per version
    pool_by_ver: dict[str, list[dict]] = defaultdict(list)
    seen = set()
    for r in store.rows:
        if r.get("level") != "section":
            continue
        ver = str(r.get("version"))
        sec = r.get("section_number") or r.get("rule_number")
        if not sec or ver == "None":
            continue
        key = (ver, sec)
        if key in seen:
            continue
        seen.add(key)
        lbl = "rule" if r.get("rule_number") else "section"
        pool_by_ver[ver].append({"version": ver, "sec": sec, "act": r["act_name"], "lbl": lbl})

    rng = random.Random(42)
    versions = sorted(pool_by_ver)
    for v in versions:
        rng.shuffle(pool_by_ver[v])
    # round-robin across versions so every round covers all versions
    need = ROUNDS * PER_ROUND
    cursors = {v: 0 for v in versions}
    qs: list[dict] = []
    vi = 0
    while len(qs) < need:
        v = versions[vi % len(versions)]
        vi += 1
        lst = pool_by_ver[v]
        if not lst:
            continue
        item = dict(lst[cursors[v] % len(lst)])
        cursors[v] += 1
        tmpl = TEMPLATES[len(qs) % len(TEMPLATES)]
        item["q"] = tmpl.format(lbl=item["lbl"], sec=item["sec"], act=item["act"])
        qs.append(item)
    return qs


def run_one(store, item: dict) -> dict:
    q = item["q"]
    t0 = time.time()
    passages = store.retrieve(q, version=item["version"])
    ret_ms = (time.time() - t0) * 1000
    rec = {"version": item["version"], "sec": item["sec"], "grounded": bool(passages),
           "ret_ms": ret_ms, "user_tokens": ntok(q), "n_passages": len(passages)}
    if not passages:
        rec.update(chunk_tokens=0, chunk_tokens_full=0, chunk_used_pct=None,
                   prompt_tokens=0, generated_tokens=0, gen_ms=0,
                   complete=0, incomplete=0, hit=False)
        return rec

    # context-token-budget packing (same logic the API/chatbot now uses)
    packed = rag_core.pack_passages(passages)
    used_texts = [p["sent_text"] for p in packed]
    full_texts = [p["row"]["text"] for p in packed]
    complete = sum(1 for p in packed if not p["truncated"])
    incomplete = sum(1 for p in packed if p["truncated"])
    rec["n_passages"] = len(packed)               # chunks actually sent
    chunk_used = ntok("\n\n".join(used_texts))
    chunk_full = ntok("\n\n".join(full_texts))

    # actual generation (gives exact prompt/completion tokens via usage)
    blocks = [f"[{n}] ({p['row']['breadcrumb']})\n{t}"
              for n, (p, t) in enumerate(zip(packed, used_texts), 1)]
    user = f"QUESTION: {q}\n\nPASSAGES:\n" + "\n\n".join(blocks)
    t0 = time.time()
    out = _post(rag_core.LLM + "/chat/completions", {
        "model": rag_core.LLM_MODEL, "temperature": 0.1, "max_tokens": rag_core.GEN_MAX_TOKENS,
        "messages": [{"role": "system", "content": rag_core.SYSTEM_PROMPT},
                     {"role": "user", "content": user}]})
    gen_ms = (time.time() - t0) * 1000
    usage = out.get("usage", {})
    secs = {(p["row"].get("section_number") or p["row"].get("rule_number") or "").upper()
            for p in passages}
    rec.update(
        chunk_tokens=chunk_used, chunk_tokens_full=chunk_full,
        chunk_used_pct=(chunk_used / chunk_full * 100) if chunk_full else None,
        prompt_tokens=usage.get("prompt_tokens", 0),
        generated_tokens=usage.get("completion_tokens", 0),
        gen_ms=gen_ms, complete=complete, incomplete=incomplete,
        hit=item["sec"].upper() in secs)
    return rec


def main() -> None:
    store = rag_core.Store_singleton()
    questions = build_questions(store)
    print(f"generated {len(questions)} questions ({ROUNDS} rounds x {PER_ROUND}); "
          f"versions: {sorted({q['version'] for q in questions})}")

    # CPU sampler
    cpu_samples: list[float] = []
    stop = threading.Event()

    def sample():
        psutil.cpu_percent()  # prime
        while not stop.is_set():
            cpu_samples.append(psutil.cpu_percent(interval=0.5))
    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()

    t_start = time.time()
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        for i, rec in enumerate(ex.map(lambda it: run_one(store, it), questions), 1):
            results.append(rec)
            if i % 79 == 0:
                print(f"  round {i//79}/{ROUNDS} done ({i}/{len(questions)})")
    wall = time.time() - t_start
    stop.set(); sampler.join(timeout=2)

    def avg(key, rows=results, cond=lambda r: True):
        vals = [r[key] for r in rows if cond(r) and r.get(key) is not None]
        return sum(vals) / len(vals) if vals else 0.0

    grounded = [r for r in results if r["grounded"]]
    tot_complete = sum(r["complete"] for r in grounded)
    tot_incomplete = sum(r["incomplete"] for r in grounded)
    tot_chunks = tot_complete + tot_incomplete

    report = {
        "config": {"rounds": ROUNDS, "per_round": PER_ROUND, "total_questions": len(questions),
                   "concurrency": CONCURRENCY, "cores": psutil.cpu_count(),
                   "passage_char_cap": rag_core.MAX_PASSAGE_CHARS},
        "wall_seconds": round(wall, 1),
        "throughput_q_per_min": round(len(questions) / wall * 60, 1),
        "tokens_avg": {
            "user_tokens": round(avg("user_tokens"), 1),
            "chunk_tokens": round(avg("chunk_tokens", grounded), 1),
            "chunk_tokens_full": round(avg("chunk_tokens_full", grounded), 1),
            "prompt_tokens": round(avg("prompt_tokens", grounded), 1),
            "generated_tokens": round(avg("generated_tokens", grounded), 1),
        },
        "chunk_usage": {
            "avg_pct_of_chunk_used_per_prompt": round(avg("chunk_used_pct", grounded), 1),
            "avg_passages_per_prompt": round(avg("n_passages", grounded), 2),
            "total_chunks_used": tot_chunks,
            "complete_chunks": tot_complete,
            "incomplete_chunks_truncated": tot_incomplete,
            "pct_complete": round(tot_complete / tot_chunks * 100, 1) if tot_chunks else 0,
            "pct_incomplete": round(tot_incomplete / tot_chunks * 100, 1) if tot_chunks else 0,
        },
        "quality": {
            "retrieval_hit_rate_pct": round(sum(r["hit"] for r in results) / len(results) * 100, 1),
            "grounding_rate_pct": round(len(grounded) / len(results) * 100, 1),
        },
        "latency_ms": {
            "retrieve_avg": round(avg("ret_ms"), 0),
            "generate_avg": round(avg("gen_ms", grounded), 0),
        },
        "cpu_impact": {
            "cores": psutil.cpu_count(),
            "system_cpu_pct_avg": round(sum(cpu_samples) / len(cpu_samples), 1) if cpu_samples else None,
            "system_cpu_pct_peak": round(max(cpu_samples), 1) if cpu_samples else None,
            "samples": len(cpu_samples),
        },
        "per_version": {},
        "per_round": [],
    }
    for v in sorted({r["version"] for r in results}):
        rv = [r for r in results if r["version"] == v]
        gv = [r for r in rv if r["grounded"]]
        report["per_version"][v] = {
            "questions": len(rv),
            "retrieval_hit_pct": round(sum(r["hit"] for r in rv) / len(rv) * 100, 1),
            "user_tokens": round(avg("user_tokens", rv), 1),
            "chunk_tokens": round(avg("chunk_tokens", gv), 1),
            "generated_tokens": round(avg("generated_tokens", gv), 1),
            "chunk_used_pct": round(avg("chunk_used_pct", gv), 1),
        }
    for rnd in range(ROUNDS):
        rr = results[rnd * PER_ROUND:(rnd + 1) * PER_ROUND]
        gr = [r for r in rr if r["grounded"]]
        report["per_round"].append({
            "round": rnd + 1,
            "retrieval_hit_pct": round(sum(r["hit"] for r in rr) / len(rr) * 100, 1),
            "user_tokens": round(avg("user_tokens", rr), 1),
            "chunk_tokens": round(avg("chunk_tokens", gr), 1),
            "generated_tokens": round(avg("generated_tokens", gr), 1),
            "chunk_used_pct": round(avg("chunk_used_pct", gr), 1),
        })

    OUT.write_text(json.dumps(report, indent=2))
    print("\n" + json.dumps(report, indent=2))
    print("\nsaved ->", OUT)


if __name__ == "__main__":
    main()
