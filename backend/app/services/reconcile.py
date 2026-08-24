"""AIS / 26AS-style reconciliation engine — pure, stateless, unit-tested.

Given two sets of entries (e.g. TDS/tax-credit rows from 26AS and from AIS or
the books), each ``{key, name, amount}``, aggregate by a normalised key (TAN /
deductor / party) and classify:

* matched         — present in both, amounts within tolerance
* amount_mismatch — present in both, amounts differ beyond tolerance
* only_in_a       — present only in source A
* only_in_b       — present only in source B

Parsing official AIS/26AS PDFs is out of scope for this engine — the caller
supplies structured rows (from a CSV / manual entry / a future parser).
"""
from __future__ import annotations


def _norm(key: str | None) -> str:
    return (key or "").strip().upper().replace(" ", "")


def _aggregate(rows: list[dict]) -> dict[str, dict]:
    agg: dict[str, dict] = {}
    for r in rows or []:
        k = _norm(r.get("key"))
        if not k:
            continue
        cur = agg.setdefault(k, {"key": (r.get("key") or "").strip(),
                                 "name": (r.get("name") or "").strip(), "amount": 0.0})
        cur["amount"] += float(r.get("amount") or 0)
        if not cur["name"] and r.get("name"):
            cur["name"] = r["name"].strip()
    return agg


def reconcile(rows_a: list[dict], rows_b: list[dict], tolerance: float = 1.0) -> dict:
    a = _aggregate(rows_a)
    b = _aggregate(rows_b)
    matched: list[dict] = []
    mismatch: list[dict] = []
    only_a: list[dict] = []
    only_b: list[dict] = []

    for k in sorted(set(a) | set(b)):
        ea, eb = a.get(k), b.get(k)
        if ea and eb:
            diff = round(ea["amount"] - eb["amount"], 2)
            row = {"key": ea["key"], "name": ea["name"] or eb["name"],
                   "amount_a": round(ea["amount"], 2), "amount_b": round(eb["amount"], 2),
                   "diff": diff}
            (matched if abs(diff) <= tolerance else mismatch).append(row)
        elif ea:
            only_a.append({"key": ea["key"], "name": ea["name"], "amount": round(ea["amount"], 2)})
        else:
            only_b.append({"key": eb["key"], "name": eb["name"], "amount": round(eb["amount"], 2)})

    return {
        "matched": matched,
        "amount_mismatch": mismatch,
        "only_in_a": only_a,
        "only_in_b": only_b,
        "summary": {
            "total_a": round(sum(x["amount"] for x in a.values()), 2),
            "total_b": round(sum(x["amount"] for x in b.values()), 2),
            "matched_count": len(matched),
            "mismatch_count": len(mismatch),
            "only_a_count": len(only_a),
            "only_b_count": len(only_b),
        },
    }
