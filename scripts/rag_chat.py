"""BharathTax RAG chatbot — interactive driver over the hybrid RAG core."""
from __future__ import annotations

import argparse

import rag_core


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("question")
    ap.add_argument("--version", help="filter to an Act/Rules year, e.g. 1961 or 2025")
    ap.add_argument("--source", help="filter to a source_key, e.g. it_act_1961")
    ap.add_argument("--show-passages", action="store_true")
    args = ap.parse_args()

    res = rag_core.answer(args.question, version=args.version, source=args.source)
    print(f"\nQ: {args.question}")
    print(f"grounded passages: {len(res['passages'])}")
    if args.show_passages:
        for n, p in enumerate(res["passages"], 1):
            print(f"  [{n}] rerank={p['score']:.3f}  {p['row']['breadcrumb'][:95]}")
    print("\nANSWER:\n" + res["text"])
    if res["passages"]:
        print("\nCITATIONS:")
        for n, p in enumerate(res["passages"], 1):
            r = p["row"]
            sec = r.get("section_number") or r.get("rule_number") or ""
            print(f"  [{n}] {r['act_name']} {sec}  —  {r['breadcrumb'][:90]}")


if __name__ == "__main__":
    main()
