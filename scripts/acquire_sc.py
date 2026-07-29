"""Acquire income-tax judgments from the AWS 'Indian Supreme Court Judgments' open
dataset (s3://indian-supreme-court-judgments, public, ap-south-1).

Simpler than the HC dataset: one court, one metadata.parquet per year, English PDFs
at data/pdf/year=YYYY/english/<path>_EN.pdf. We filter by title/petitioner/respondent
for income-tax (apex-court tax judgments = binding precedent, high value, small set).

  python scripts/acquire_sc.py harvest      # scan metadata -> sc_manifest.jsonl
  python scripts/acquire_sc.py download      # fetch PDFs + write case_law manifest.jsonl
then ingest:  docker exec -e CASELAW_NO_EMBED=1 -e ITD_SKIP_OCR=1 ... \
                python -m app.ingestion.case_law /data/manual/case_law_sc
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import pyarrow.dataset as ds
import pyarrow.fs as pafs
from botocore import UNSIGNED
from botocore.config import Config

BKT = "indian-supreme-court-judgments"
REGION = "ap-south-1"
TAX = re.compile(r"income[- ]?tax|commissioner of income|principal commissioner of income", re.I)
COLS = ["title", "petitioner", "respondent", "cnr", "case_id", "citation",
        "decision_date", "disposal_nature", "path", "year"]
OUT = Path("data/manual/case_law_sc")
SC_MANIFEST = OUT / "sc_manifest.jsonl"
PDF_DIR = OUT / "sc_pdfs"
INGEST_MANIFEST = OUT / "manifest.jsonl"


def _s3():
    return boto3.client("s3", region_name=REGION,
                        config=Config(signature_version=UNSIGNED, max_pool_connections=64))


def _years(cl):
    out, tok = [], None
    while True:
        kw = dict(Bucket=BKT, Prefix="metadata/parquet/", Delimiter="/")
        if tok:
            kw["ContinuationToken"] = tok
        r = cl.list_objects_v2(**kw)
        out += [p["Prefix"].split("year=")[-1].strip("/") for p in r.get("CommonPrefixes", [])]
        if r.get("IsTruncated"):
            tok = r["NextContinuationToken"]
        else:
            return out


def _scan_year(fs, year):
    key = f"metadata/parquet/year={year}/metadata.parquet"
    try:
        t = ds.dataset(f"{BKT}/{key}", filesystem=fs, format="parquet").to_table(columns=COLS)
    except Exception:
        return []
    d = t.to_pydict()
    n = len(d["title"])
    out = []
    for i in range(n):
        blob = " ".join(str(d[c][i] or "") for c in ("title", "petitioner", "respondent"))
        if not TAX.search(blob):
            continue
        path = d["path"][i]
        if not path:
            continue
        out.append({
            "pdf_key": f"data/pdf/year={year}/english/{path}_EN.pdf",
            "title": (str(d["title"][i] or "") or f"{d['petitioner'][i]} vs {d['respondent'][i]}")[:300],
            "court": "Supreme Court of India",
            "cnr": d["cnr"][i], "citation": d["citation"][i] or d["case_id"][i],
            "date": str(d["decision_date"][i])[:10], "disposal": d["disposal_nature"][i],
        })
    return out


def harvest():
    cl = _s3()
    fs = pafs.S3FileSystem(anonymous=True, region=REGION)
    years = _years(cl)
    print(f"scanning {len(years)} years...", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    with SC_MANIFEST.open("w", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=16) as ex:
        futs = {ex.submit(_scan_year, fs, y): y for y in years}
        for fut in as_completed(futs):
            for row in fut.result():
                f.write(json.dumps(row, default=str) + "\n")
                n += 1
    print(f"DONE harvest: {n} income-tax Supreme Court judgments -> {SC_MANIFEST}", flush=True)


def download():
    cl = _s3()
    rows = [json.loads(l) for l in SC_MANIFEST.read_text(encoding="utf-8").splitlines() if l.strip()]
    seen, uniq = set(), []
    for r in rows:
        if r["pdf_key"] not in seen:
            seen.add(r["pdf_key"]); uniq.append(r)
    print(f"{len(uniq)} unique SC judgments to download", flush=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)

    def dl(row):
        key = row["pdf_key"]
        dest = PDF_DIR / key.split("/")[-1]
        if dest.exists() and dest.stat().st_size > 0:
            return (dest.name, row)
        try:
            b = cl.get_object(Bucket=BKT, Key=key)["Body"].read()
            if b[:4] != b"%PDF":
                return None
            dest.write_bytes(b)
            return (dest.name, row)
        except Exception:
            return None

    ok = 0
    with INGEST_MANIFEST.open("w", encoding="utf-8") as mf, ThreadPoolExecutor(max_workers=32) as ex:
        for res in ex.map(dl, uniq):
            if res:
                fname, row = res
                mf.write(json.dumps({"fname": fname, "title": row["title"],
                                     "court_name": row["court"], "pdf_key": row["pdf_key"]}) + "\n")
                ok += 1
    print(f"DONE download: {ok} PDFs -> {PDF_DIR}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["harvest", "download"])
    a = ap.parse_args()
    harvest() if a.cmd == "harvest" else download()


if __name__ == "__main__":
    main()
