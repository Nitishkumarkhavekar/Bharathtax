"""Export a fine-tuning / distillation dataset from the ai_capture flywheel store.

Turns captured chat turns (question -> grounded answer, the Gemini "teacher"
output) into a clean JSONL the LoRA fine-tune of the in-house Llama consumes.
PII is scrubbed before anything leaves the DB. This is the FIRST stage of the
Stage-1 flywheel loop:  capture -> [export+curate] -> fine-tune -> eval -> deploy.

Run in-container:
    docker exec -i bharathtax-web-worker-1 \
        python -m app.scripts.export_finetune_data --out /data/finetune.jsonl \
               --min-answer-chars 400 --min-stars 0

Output line (chat fine-tune format):
    {"messages": [{"role":"user","content": q}, {"role":"assistant","content": a}],
     "meta": {"id":..., "model":..., "stars":..., "ts":...}}
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re

from sqlalchemy import text

from app.core.db import SessionLocal

# --- PII scrubbing (structured identifiers). Names need NER — see the privacy
#     plan; this pass masks the high-risk structured IDs deterministically. ----
_PII = [
    (re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b"), "[PAN]"),
    (re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b"), "[GSTIN]"),
    (re.compile(r"\b\d{4}\s?\d{4}\s?\d{4}\b"), "[AADHAAR]"),
    (re.compile(r"\b(?:\+91[-\s]?)?[6-9]\d{9}\b"), "[PHONE]"),
    (re.compile(r"\b[\w.\-]+@[\w.\-]+\.\w+\b"), "[EMAIL]"),
]


def scrub(s: str) -> str:
    """Regex pass: structured identifiers (PAN/GSTIN/Aadhaar/phone/email)."""
    s = s or ""
    for rx, repl in _PII:
        s = rx.sub(repl, s)
    return s


# --- On-prem NER name scrubbing (spaCy). Runs entirely in-container — no data
#     leaves the box, so it respects the tax-data governance rule. Masks PERSON
#     (individual taxpayers/officers) by default; ORG opt-in (masking company
#     names in legal citations degrades the data, so it is off unless asked). ---
_nlp = None
_ner_tried = False


def _get_nlp():
    global _nlp, _ner_tried
    if _ner_tried:
        return _nlp
    _ner_tried = True
    try:
        import spacy
        # NER-only pipeline — drop the components we don't need for speed.
        _nlp = spacy.load("en_core_web_sm",
                          disable=["lemmatizer", "tagger", "parser", "attribute_ruler"])
    except Exception as e:  # noqa: BLE001
        print(f"[warn] spaCy NER unavailable ({type(e).__name__}); "
              f"name scrubbing DISABLED — regex PII only. "
              f"Install: pip install spacy && python -m spacy download en_core_web_sm")
        _nlp = None
    return _nlp


def ner_scrub(s: str, mask_orgs: bool = False) -> str:
    nlp = _get_nlp()
    if not nlp or not s:
        return s
    labels = {"PERSON"} | ({"ORG"} if mask_orgs else set())
    doc = nlp(s)
    spans = [(e.start_char, e.end_char, e.label_) for e in doc.ents if e.label_ in labels]
    for a, b, lab in sorted(spans, reverse=True):  # right-to-left keeps offsets valid
        s = s[:a] + f"[{lab}]" + s[b:]
    return s


def redact(s: str, *, ner: bool, mask_orgs: bool) -> str:
    s = scrub(s)
    if ner:
        s = ner_scrub(s, mask_orgs=mask_orgs)
    return s


def _stars_lookup(db) -> dict:
    """chat ratings keyed by md5(question)[:16] (how ratings stores chat target_id)."""
    out: dict[str, int] = {}
    try:
        for tid, stars in db.execute(text(
                "SELECT target_id, stars FROM ratings WHERE target_type='chat'")):
            out[tid] = int(stars)
    except Exception:  # noqa: BLE001  (ratings table may not exist yet)
        pass
    return out


def export(out_path: str, min_answer_chars: int, min_stars: int,
           *, ner: bool = True, mask_orgs: bool = False) -> dict:
    db = SessionLocal()
    stars = _stars_lookup(db)
    kept = skipped = 0
    try:
        rows = db.execute(text(
            "SELECT id, user_prompt, response, model, ts, meta "
            "FROM ai_capture WHERE kind='chat' AND response IS NOT NULL "
            "ORDER BY ts")).fetchall()
        with open(out_path, "w", encoding="utf-8") as f:
            for _id, q, a, model, ts, meta in rows:
                q, a = (q or "").strip(), (a or "").strip()
                if len(a) < min_answer_chars or len(q) < 3:
                    skipped += 1
                    continue
                key = hashlib.md5(q.encode("utf-8")).hexdigest()[:16]
                st = stars.get(key, 0)
                if min_stars and st < min_stars:
                    skipped += 1
                    continue
                rec = {
                    "messages": [
                        {"role": "user", "content": redact(q, ner=ner, mask_orgs=mask_orgs)},
                        {"role": "assistant", "content": redact(a, ner=ner, mask_orgs=mask_orgs)},
                    ],
                    "meta": {"id": _id, "model": model, "stars": st or None,
                             "ts": ts.isoformat() if ts else None},
                }
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                kept += 1
    finally:
        db.close()
    result = {"kept": kept, "skipped": skipped, "out": out_path}
    print("export:", result)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Export fine-tune dataset from ai_capture")
    ap.add_argument("--out", required=True, help="output .jsonl path")
    ap.add_argument("--min-answer-chars", type=int, default=400,
                    help="drop stub answers shorter than this")
    ap.add_argument("--min-stars", type=int, default=0,
                    help="keep only turns rated >= N stars (0 = all)")
    ap.add_argument("--no-ner", action="store_true",
                    help="disable spaCy PERSON-name scrubbing (regex PII only)")
    ap.add_argument("--mask-orgs", action="store_true",
                    help="also mask ORG names (stricter; degrades legal citations)")
    a = ap.parse_args()
    export(a.out, a.min_answer_chars, a.min_stars,
           ner=not a.no_ner, mask_orgs=a.mask_orgs)
