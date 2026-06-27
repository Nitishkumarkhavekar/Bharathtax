"""Standalone corpus-dataset builder for the BharathTax RAG chatbot.

Reuses the repo's real ingestion code (extract -> structure-aware parse -> chunk)
to turn the manual-drop Acts/Rules PDFs into an embedded vector store, WITHOUT
needing Postgres/MinIO (those live on the app VPS). Embeddings come from the
ml-server (bge-m3) running on this GPU box.

Output (under data/corpus_dataset/):
  chunks.jsonl      one row per chunk: id, source_key, domain, doc_type,
                    breadcrumb, level, section/rule no., body, text(=embedded)
  embeddings.npy    float32 [N, 1024], row-aligned with chunks.jsonl
  manifest.json     build stats / provenance

Run:  PYTHONPATH=backend .dsenv/bin/python scripts/build_corpus_dataset.py
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from dataclasses import asdict
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np
import yaml

from app.ingestion.chunk import chunk_units
from app.ingestion.parse import get_parser

REPO = Path(__file__).resolve().parents[1]
SOURCES = REPO / "config/sources.yaml"
MANUAL = REPO / "data/manual"
OUT = REPO / "data/corpus_dataset"
ML = "http://127.0.0.1:8001"
EMBED_BATCH = 64
_MIN_CHARS = 20  # below this a page is treated as image-only (no OCR here)


def extract_pdf(path: Path) -> str:
    doc = fitz.open(path)
    pages = []
    thin = 0
    for page in doc:
        t = page.get_text()
        if len(t.strip()) < _MIN_CHARS:
            thin += 1
        pages.append(t)
    if thin:
        print(f"      note: {thin}/{doc.page_count} pages had ~no text layer (skipped, no OCR)")
    return "\n".join(pages)


def embed(texts: list[str]) -> list[list[float]]:
    req = urllib.request.Request(
        ML + "/embed",
        data=json.dumps({"texts": texts}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=600))["embeddings"]


def main() -> None:
    cfg = yaml.safe_load(SOURCES.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []

    for src in cfg["sources"]:
        if not src.get("enabled") or src.get("fetcher") != "manual":
            continue
        files = sorted(p for p in MANUAL.glob(src["manual_glob"])
                       if p.is_file() and not p.name.endswith(".meta.json")
                       and not p.name.startswith("."))
        if not files:
            print(f"[skip] {src['key']}: no files for glob {src['manual_glob']}")
            continue
        parser = get_parser(src["parser"])
        act_name = src["name"]                       # correct per-source name (1961 vs 2025, etc.)
        ym = re.search(r"(19|20)\d{2}", src["key"])
        version = ym.group(0) if ym else None        # e.g. "1961", "2025"
        for f in files:
            t0 = time.time()
            print(f"[{src['key']}] {f.name}  (act_name={act_name!r} version={version})")
            text = extract_pdf(f)
            # Act/Rules parsers accept the real act_name; cbdt parser does not.
            units = list(parser(text, act_name=act_name) if src["parser"] in ("it_act", "it_rules")
                         else parser(text))
            chunks = chunk_units(units)
            for c in chunks:
                d = asdict(c)
                d["level"] = c.level.value
                d.pop("effective_date", None)
                d.update(source_key=src["key"], domain=src["domain"],
                         doc_type=src["source_type"], origin=f.name,
                         act_name=act_name, version=version)
                rows.append(d)
            print(f"      pages->units={len(units)}  chunks={len(chunks)}  ({time.time()-t0:.1f}s)")

    print(f"\nTotal chunks: {len(rows)}  -> embedding via bge-m3 ...")
    vecs = np.zeros((len(rows), 1024), dtype=np.float32)
    t0 = time.time()
    for i in range(0, len(rows), EMBED_BATCH):
        batch = [r["text"] for r in rows[i:i + EMBED_BATCH]]
        out = embed(batch)
        vecs[i:i + len(out)] = np.asarray(out, dtype=np.float32)
        if i % (EMBED_BATCH * 20) == 0:
            print(f"  embedded {min(i+len(out), len(rows))}/{len(rows)}")
    dt = time.time() - t0

    # assign ids, write artifacts
    for i, r in enumerate(rows):
        r["id"] = i
    (OUT / "chunks.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
    np.save(OUT / "embeddings.npy", vecs)
    by_src: dict[str, int] = {}
    for r in rows:
        by_src[r["source_key"]] = by_src.get(r["source_key"], 0) + 1
    manifest = {
        "total_chunks": len(rows),
        "embedding_dim": 1024,
        "embedding_model": "BAAI/bge-m3",
        "by_source": by_src,
        "embed_seconds": round(dt, 1),
        "embed_throughput_per_sec": round(len(rows) / dt, 1) if dt else None,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("\n=== DATASET BUILT ===")
    print(json.dumps(manifest, indent=2))
    print("Artifacts in", OUT)


if __name__ == "__main__":
    main()
