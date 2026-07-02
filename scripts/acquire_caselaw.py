"""Acquire income-tax judgments from the AWS 'Indian High Court Judgments' open
dataset (s3://indian-high-court-judgments, public, ap-south-1).

The dataset is ~16M judgments across 25 High Courts, 1950-present, but only ~0.1%
are income-tax. We filter the parquet metadata by case title (Commissioner of
Income Tax / Income-tax ...) and download only those PDFs — tractable.

Layout:
  metadata/parquet/year=YYYY/court=CC/bench=BB/metadata.parquet   (title, pdf_link, cnr, ...)
  data/pdf/year=YYYY/court=CC/bench=BB/<basename(pdf_link)>       (the judgment PDF)

Two phases:
  python scripts/acquire_caselaw.py harvest            # scan metadata -> hc_manifest.jsonl
  python scripts/acquire_caselaw.py download           # fetch PDFs + write case_law manifest.jsonl
then ingest:  docker exec ... python -m app.ingestion.case_law /data/manual/case_law
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
import pyarrow.dataset as ds
import pyarrow.fs as pafs
from botocore import UNSIGNED
from botocore.config import Config

BKT = "indian-high-court-judgments"
REGION = "ap-south-1"
# income-tax case titles: "... Vs COMMISSIONER OF INCOME TAX", "INCOME TAX OFFICER ...", etc.
TAX = re.compile(r"income[- ]?tax|commissioner of income|principal commissioner of income", re.I)
COLS = ["title", "pdf_link", "cnr", "decision_date", "disposal_nature", "court"]
OUT = Path("data/manual/case_law")
HC_MANIFEST = OUT / "hc_manifest.jsonl"      # matched metadata rows
PDF_DIR = OUT / "hc_pdfs"
INGEST_MANIFEST = OUT / "manifest.jsonl"     # consumed by app.ingestion.case_law


def _s3():
    return boto3.client("s3", region_name=REGION,
                        config=Config(signature_version=UNSIGNED, max_pool_connections=64))


def _list_prefixes(cl, prefix):
    out, tok = [], None
    while True:
        kw = dict(Bucket=BKT, Prefix=prefix, Delimiter="/")
        if tok:
            kw["ContinuationToken"] = tok
        r = cl.list_objects_v2(**kw)
        out += [p["Prefix"] for p in r.get("CommonPrefixes", [])]
        if r.get("IsTruncated"):
            tok = r["NextContinuationToken"]
        else:
            return out


def _list_parquets(cl, prefix):
    out, tok = [], None
    while True:
        kw = dict(Bucket=BKT, Prefix=prefix)
        if tok:
            kw["ContinuationToken"] = tok
        r = cl.list_objects_v2(**kw)
        out += [o["Key"] for o in r.get("Contents", []) if o["Key"].endswith(".parquet")]
        if r.get("IsTruncated"):
            tok = r["NextContinuationToken"]
        else:
            return out


def _scan_parquet(fs, key):
    """Return matched income-tax rows from one metadata parquet (column-pruned read)."""
    try:
        table = ds.dataset(f"{BKT}/{key}", filesystem=fs, format="parquet").to_table(columns=COLS)
    except Exception as e:  # transient S3 / bad file
        return []
    titles = table.column("title").to_pylist()
    plinks = table.column("pdf_link").to_pylist()
    cnrs = table.column("cnr").to_pylist()
    dates = table.column("decision_date").to_pylist()
    disp = table.column("disposal_nature").to_pylist()
    courts = table.column("court").to_pylist()
    part = key.replace("metadata/parquet/", "data/pdf/").replace("metadata.parquet", "")
    out = []
    for i, t in enumerate(titles):
        if t and TAX.search(str(t)) and plinks[i]:
            out.append({
                "pdf_key": part + os.path.basename(str(plinks[i])),
                "title": str(t)[:300],
                "court": courts[i],
                "cnr": cnrs[i],
                "date": str(dates[i])[:10],
                "disposal": disp[i],
            })
    return out


def harvest(years: set[str] | None = None):
    cl = _s3()
    fs = pafs.S3FileSystem(anonymous=True, region=REGION)
    yprefs = _list_prefixes(cl, "metadata/parquet/")
    if years:
        yprefs = [y for y in yprefs if any(f"year={yr}/" in y for yr in years)]
    print(f"scanning {len(yprefs)} year partitions...", flush=True)
    parquets: list[str] = []
    with ThreadPoolExecutor(max_workers=24) as ex:
        for pl in ex.map(lambda y: _list_parquets(cl, y), yprefs):
            parquets += pl
    print(f"{len(parquets)} parquet files to scan", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    n = done = 0
    with HC_MANIFEST.open("w", encoding="utf-8") as f, ThreadPoolExecutor(max_workers=24) as ex:
        futs = {ex.submit(_scan_parquet, fs, k): k for k in parquets}
        for fut in as_completed(futs):
            for row in fut.result():
                f.write(json.dumps(row, default=str) + "\n")
                n += 1
            done += 1
            if done % 200 == 0:
                print(f"  scanned {done}/{len(parquets)} parquet | {n} income-tax judgments", flush=True)
    print(f"DONE harvest: {n} income-tax judgments -> {HC_MANIFEST}", flush=True)


# substantive tax appeals/references (reasoned rulings) vs procedural writs/motions
_SUBSTANTIVE = re.compile(
    r"^\s*(ITXA|ITTA|ITA|ITR|ITAT|TAXAP|TCA|WTA|WTR|WTC|CEA|TAX ?APPEAL|"
    r"D\.?B\.? ?ITA|INCOME ?TAX ?APPEAL|INCOME ?TAX ?REFERENCE)\b", re.I)


def download(substantive: bool = False, min_year: str | None = None):
    cl = _s3()
    rows = [json.loads(l) for l in HC_MANIFEST.read_text(encoding="utf-8").splitlines() if l.strip()]
    # optional quality/recency filters (incremental: widen later, idempotent skip)
    if substantive:
        rows = [r for r in rows if _SUBSTANTIVE.match(str(r["title"]))]
    if min_year:
        rows = [r for r in rows if (r.get("date") or "")[:4] >= min_year]
    # de-dup by pdf_key (same order can appear under multiple partitions)
    seen, uniq = set(), []
    for r in rows:
        if r["pdf_key"] not in seen:
            seen.add(r["pdf_key"]); uniq.append(r)
    print(f"{len(uniq)} unique judgments to download "
          f"(substantive={substantive}, min_year={min_year})", flush=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)

    def dl(row):
        key = row["pdf_key"]
        dest = PDF_DIR / os.path.basename(key)
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
                if ok % 500 == 0:
                    print(f"  downloaded {ok}/{len(uniq)}", flush=True)
    print(f"DONE download: {ok} PDFs -> {PDF_DIR}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["harvest", "download"])
    ap.add_argument("--years", help="harvest: comma-separated years to limit")
    ap.add_argument("--substantive", action="store_true",
                    help="download: only substantive tax appeals/references (drop procedural writs)")
    ap.add_argument("--min-year", help="download: only judgments from this year onward")
    a = ap.parse_args()
    if a.cmd == "harvest":
        harvest(set(a.years.split(",")) if a.years else None)
    else:
        download(substantive=a.substantive, min_year=a.min_year)


if __name__ == "__main__":
    main()
