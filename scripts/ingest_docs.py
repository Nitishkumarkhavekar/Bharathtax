#!/usr/bin/env python3
"""Incremental ingestion of CBDT circulars / notifications / forms / e-filing
guides into the RAG corpus.

Structure-aware chunking: each document is split into paragraph blocks and EVERY
chunk is prefixed with the document header (type, number, date, title) so a
retrieved fragment always carries its provenance — fixing the "circular
fragment / distribution-page" problem where a stray chunk had no context.
Chunks are embedded with bge-m3 (ml-server) and APPENDED to the existing corpus
(chunks.jsonl + embeddings.npy) — no full rebuild.

Usage:
    ingest_docs.py <docs_dir>

Each file <name>.pdf|.txt|.md may carry a sidecar <name>.meta.json:
    {"title": "...", "doc_type": "circular|notification|form|manual|instruction",
     "number": "13/2024", "date": "2024-10-26", "url": "https://..."}

Env:
    CORPUS_DATASET_DIR  override the corpus dir (used for safe testing).
After a run, restart `bharattax-api` so rag_core reloads the updated corpus.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[1]
CORPUS = Path(os.getenv("CORPUS_DATASET_DIR", str(REPO / "data/corpus_dataset")))
ML = os.getenv("ML_URL", "http://127.0.0.1:8001")


def embed(texts: list[str]) -> list[list[float]]:
    req = urllib.request.Request(
        ML + "/embed",
        data=json.dumps({"texts": texts}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=600))["embeddings"]


def extract_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in (".txt", ".md"):
        return path.read_text(errors="ignore")
    if ext == ".pdf":
        import fitz  # PyMuPDF

        doc = fitz.open(path)
        text = "\n\n".join(pg.get_text() for pg in doc)
        if len(text.strip()) < 20 * doc.page_count:  # scanned -> OCR fallback
            try:
                import pytesseract
                from PIL import Image
                import io

                ocr = []
                for pg in doc:
                    pix = pg.get_pixmap(dpi=200)
                    ocr.append(pytesseract.image_to_string(Image.open(io.BytesIO(pix.tobytes("png")))))
                text = "\n\n".join(ocr)
            except Exception:
                pass
        return text
    return ""


def chunk_doc(text: str, header: str, *, max_chars: int = 1200, overlap: int = 150) -> list[str]:
    """Split into paragraph blocks packed to ~max_chars, header prepended to each
    chunk so every chunk is self-describing."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paras:
        if buf and len(buf) + len(p) + 2 > max_chars:
            chunks.append(buf.strip())
            buf = (buf[-overlap:] + "\n\n" + p) if overlap else p
        else:
            buf = (buf + "\n\n" + p) if buf else p
    if buf.strip():
        chunks.append(buf.strip())
    return [f"{header}\n\n{c}" for c in chunks]


def _load_meta(f: Path) -> dict:
    for m in (f.with_suffix(f.suffix + ".meta.json"), f.with_suffix(".meta.json")):
        if m.exists():
            try:
                return json.loads(m.read_text())
            except Exception:
                pass
    return {}


def main() -> None:
    docs_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else (REPO / "data/manual/docs")
    files = [f for f in sorted(docs_dir.glob("*")) if f.suffix.lower() in (".pdf", ".txt", ".md")]
    if not files:
        print("No documents (.pdf/.txt/.md) found in", docs_dir)
        return

    rows = [json.loads(l) for l in (CORPUS / "chunks.jsonl").read_text().splitlines() if l.strip()]
    existing = np.load(CORPUS / "embeddings.npy")
    next_id = max((int(r.get("id", 0)) for r in rows), default=-1) + 1

    new_rows: list[dict] = []
    new_texts: list[str] = []
    for f in files:
        meta = _load_meta(f)
        title = meta.get("title", f.stem)
        dtype = meta.get("doc_type", "circular")
        number = meta.get("number", "")
        date = meta.get("date", "")
        url = meta.get("url")
        header = " ".join(x for x in [
            dtype.title(),
            (f"No. {number}" if number else ""),
            (f"dated {date}" if date else ""),
            f"— {title}",
        ] if x)
        text = extract_text(f)
        if not text.strip():
            print("  skip (no extractable text):", f.name)
            continue
        chunks = chunk_doc(text, header)
        for c in chunks:
            new_rows.append({
                "text": c, "body": c, "breadcrumb": header[:200], "level": "document",
                "section_number": "None", "subsection": "None", "clause": "None",
                "act_name": title, "number": number, "date": date, "source_url": url,
                "source_key": f.stem, "domain": "income_tax", "doc_type": dtype,
                "origin": f.name, "version": (date[:4] if date else ""), "id": str(next_id),
            })
            new_texts.append(c)
            next_id += 1
        print(f"  {f.name}: {len(chunks)} chunks  [{header[:70]}]")

    if not new_texts:
        print("Nothing to ingest.")
        return

    print(f"Embedding {len(new_texts)} new chunks via bge-m3 ...")
    vecs: list[list[float]] = []
    for i in range(0, len(new_texts), 64):
        vecs += embed(new_texts[i:i + 64])
        print(f"  embedded {min(i + 64, len(new_texts))}/{len(new_texts)}")
    merged = np.concatenate([existing, np.asarray(vecs, dtype="float32")], axis=0)

    cj = CORPUS / "chunks.jsonl"
    # Guard: if the existing file doesn't end in a newline, our first appended
    # row would be glued onto the last existing row (corrupt JSONL).
    with cj.open("rb") as fh:
        last = b"\n"
        if fh.seek(0, 2) > 0:
            fh.seek(-1, 2)
            last = fh.read(1)
    with cj.open("a") as fh:
        if last != b"\n":
            fh.write("\n")
        for r in new_rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    np.save(CORPUS / "embeddings.npy", merged)

    print(f"\nAppended {len(new_rows)} chunks -> corpus is now {merged.shape[0]} chunks.")
    print("Restart bharattax-api to load the updated corpus.")


if __name__ == "__main__":
    main()
