"""Freshness orchestrator — pull NEW primary-law docs, ingest + embed the delta.

WHY a host script (not a pure Celery task): acquisition needs a real browser (the
ITD Liferay site is Akamai-gated) and boto3/pyarrow (AWS case-law), neither of which
lives in the backend container. So the split is: HOST acquires the delta -> the
CONTAINER ingests + embeds it (the same idempotent, content-deduped pipeline).

Everything is idempotent: already-have docs are skipped (byte-checksum for the ITD
source, content-hash for case law), so re-running only adds what's genuinely new.

Run on the host (a Chromium window opens for the ITD crawl):
    python scripts/freshness.py                  # all sources, current year
    python scripts/freshness.py --year 2026 --sources circulars,notifications,caselaw
    python scripts/freshness.py --no-acquire     # just (re)ingest+embed whatever's on disk

Schedule it weekly (Windows Task Scheduler / cron). After it runs, sync prod with:
    python scripts/prod_sync.py                  # incremental COPY-append to the web VPS
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import date

API = "taxmedha-api-1"
GPU_ML = "http://139.84.144.69:8001"   # durable-rule GPU embed server


def sh(cmd: list[str], **kw) -> int:
    print("  $", " ".join(cmd), flush=True)
    return subprocess.run(cmd, **kw).returncode


def _pending() -> int:
    out = subprocess.run(
        ["docker", "exec", API, "python", "-c",
         "from app.core.db import SessionLocal; from sqlalchemy import text; "
         "db=SessionLocal(); print(db.scalar(text('SELECT count(*) FROM corpus_chunks WHERE embedding IS NULL'))); db.close()"],
        capture_output=True, text=True).stdout.strip().splitlines()
    return int(out[-1]) if out and out[-1].isdigit() else 0


def acquire(year: str, sources: set[str]) -> None:
    """Delta-acquire from each source (idempotent; skips already-have docs)."""
    if "circulars" in sources:
        print(f"=== ITD circulars {year} (delta) ===", flush=True)
        sh([sys.executable, "scripts/crawl_itd.py", "circulars", year])
    if "notifications" in sources:
        print(f"=== ITD notifications {year} (delta) ===", flush=True)
        sh([sys.executable, "scripts/crawl_itd.py", "notifications", year])
    if "acts" in sources:  # a new Finance Act appears annually
        print(f"=== Acts/Rules {year} (delta) ===", flush=True)
        sh([sys.executable, "scripts/crawl_acts.py"])
    if "caselaw" in sources:
        prev = str(int(year) - 1)
        print(f"=== High Court judgments {prev},{year} (delta harvest) ===", flush=True)
        sh([sys.executable, "scripts/acquire_caselaw.py", "harvest", "--years", f"{prev},{year}"])
        sh([sys.executable, "scripts/acquire_caselaw.py", "download"])
        print("=== Supreme Court judgments (delta) ===", flush=True)
        sh([sys.executable, "scripts/acquire_sc.py", "harvest"])
        sh([sys.executable, "scripts/acquire_sc.py", "download"])


def ingest_and_embed(sources: set[str]) -> None:
    """Stage new docs (CPU) then embed the delta on the GPU (durable rule)."""
    if {"circulars", "notifications", "acts"} & sources:
        print("=== ingest ITD/act sources (stage) ===", flush=True)
        sh(["docker", "exec", "-e", "ITD_SKIP_OCR=1", API,
            "python", "-m", "app.ingestion.pipeline", "run", "--no-embed"])
    if "caselaw" in sources:
        print("=== ingest case law (stage; content-hash dedup) ===", flush=True)
        for d in ("/data/manual/case_law", "/data/manual/case_law_sc"):
            sh(["docker", "exec", "-e", "CASELAW_NO_EMBED=1", "-e", "ITD_SKIP_OCR=1", API,
                "python", "-m", "app.ingestion.case_law", d])

    pend = _pending()
    print(f"=== embed delta: {pend} new chunks ===", flush=True)
    if pend == 0:
        print("  nothing new to embed.", flush=True)
        return
    # GPU if reachable (durable rule), else the local ml-server
    reach = subprocess.run(
        ["docker", "exec", API, "python", "-c",
         f"import httpx,sys;\ntry: httpx.get('{GPU_ML}/health',timeout=8); print('gpu')\nexcept Exception: print('cpu')"],
        capture_output=True, text=True).stdout.strip().splitlines()[-1:]
    env = ["-e", f"ML_SERVER_URL={GPU_ML}"] if reach == ["gpu"] else []
    print(f"  embedding via {'GPU' if env else 'local CPU'} ml-server", flush=True)
    sh(["docker", "exec", *env, API, "python", "-m", "app.ingestion.pipeline", "embed-pending", "--batch", "256"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", default=str(date(2026, 1, 1).year))  # host clock is unreliable here; default current
    ap.add_argument("--sources", default="circulars,notifications,caselaw")
    ap.add_argument("--no-acquire", action="store_true", help="skip crawling; just ingest+embed disk state")
    a = ap.parse_args()
    sources = set(s.strip() for s in a.sources.split(","))
    print(f"### FRESHNESS run: year={a.year} sources={sorted(sources)}", flush=True)
    before = _pending()
    if not a.no_acquire:
        acquire(a.year, sources)
    ingest_and_embed(sources)
    subprocess.run(["docker", "exec", API, "python", "-m", "app.ingestion.pipeline", "verify"])
    print("### FRESHNESS done. Sync prod with: python scripts/prod_sync.py", flush=True)


if __name__ == "__main__":
    main()
