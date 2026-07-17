"""Acquire ITAT (Income-tax Appellate Tribunal) orders from the indiankanoon API
and ingest them into the case-law corpus — the missing precedent tier
(AO -> CIT(A) -> **ITAT** -> HC -> SC). The AWS open-data judgment sets we used
for HC/SC have NO tribunals, so this is how ITAT gets in.

Every ITAT order is income-tax, so `doctypes=itat` is the whole filter; a query
term is still required by the search API, so pass a section/topic (e.g.
"section 68") — targeting the common appeal grounds is the cost-efficient first
pass. indiankanoon returns TEXT, so we ingest via case_law.ingest_text (no OCR).

Auth: set IK_API_TOKEN (sign up at api.indiankanoon.org). Runs IN-CONTAINER
(needs DB + internet):
    docker exec -e IK_API_TOKEN=xxx bharathtax-web-api-1 \
        python -m app.ingestion.acquire.indiankanoon --query "section 68" --max 50

Cost: indiankanoon charges per RETURNED page — roughly Rs 0.20 per full-text
order + a few paise per search page. The script prints its page usage so spend
is predictable. Idempotent: case_law content-hash dedup means re-runs skip
orders already ingested.
"""
from __future__ import annotations

import argparse
import os
import time

import httpx
from bs4 import BeautifulSoup

from app.core.db import SessionLocal
from app.core.logging import configure_logging, get_logger
from app.ingestion import case_law

log = get_logger(__name__)
BASE = "https://api.indiankanoon.org"


def _client(token: str) -> httpx.Client:
    # IKAPI expects POST for all endpoints, with a Token auth header.
    return httpx.Client(base_url=BASE, timeout=httpx.Timeout(90.0),
                        headers={"Authorization": f"Token {token}"})


def _search(client: httpx.Client, form_input: str, pagenum: int,
            fromdate: str | None, todate: str | None) -> dict:
    params = {"formInput": form_input, "doctypes": "itat", "pagenum": pagenum}
    if fromdate:
        params["fromdate"] = fromdate
    if todate:
        params["todate"] = todate
    r = client.post("/search/", params=params)
    r.raise_for_status()
    return r.json()


def _doc_text(client: httpx.Client, tid: int) -> tuple[str, str]:
    r = client.post(f"/doc/{tid}/")
    r.raise_for_status()
    j = r.json()
    html = j.get("doc") or ""
    title = (j.get("title") or "").strip()
    text = BeautifulSoup(html, "html.parser").get_text("\n")
    # collapse the blank-line explosion bs4 leaves so paragraph chunking works
    text = "\n".join(ln.rstrip() for ln in text.splitlines())
    return title, text.strip()


def run(form_input: str, max_docs: int, fromdate: str | None, todate: str | None,
        rate: float = 0.3) -> dict:
    configure_logging()
    token = os.getenv("IK_API_TOKEN", "").strip()
    if not token:
        raise SystemExit("IK_API_TOKEN not set — get one at api.indiankanoon.org")
    db = SessionLocal()
    src = case_law.get_source(db)
    client = _client(token)
    search_pages = docs_fetched = ingested = 0
    seen: set[int] = set()
    pagenum = 0
    try:
        while ingested < max_docs and pagenum <= 200:
            res = _search(client, form_input, pagenum, fromdate, todate)
            search_pages += 1
            docs = res.get("docs") or []
            if not docs:
                break
            if pagenum == 0:
                log.info("query=%r doctypes=itat found=%s", form_input, res.get("found"))
            for d in docs:
                if ingested >= max_docs:
                    break
                tid = d.get("tid")
                if not tid or tid in seen:
                    continue
                seen.add(tid)
                try:
                    title, text = _doc_text(client, tid)
                    docs_fetched += 1
                    if len(text) < 200:
                        continue
                    n = case_law.ingest_text(
                        db, src, text, title or d.get("title") or "ITAT order",
                        source_url=f"https://indiankanoon.org/doc/{tid}/")
                    if n:
                        ingested += 1
                        log.info("  ingested %d/%d  tid=%s chunks=%d  %s",
                                 ingested, max_docs, tid, n, (title or "")[:70])
                except Exception as e:  # one bad doc must not abort the run
                    db.rollback()
                    log.warning("  tid=%s failed: %s", tid, str(e)[:120])
                time.sleep(rate)
            pagenum += 1
        out = {"search_pages": search_pages, "docs_fetched": docs_fetched,
               "ingested": ingested, "approx_billable_pages": search_pages + docs_fetched}
        log.info("DONE. %s", out)
        return out
    finally:
        db.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Acquire ITAT orders from indiankanoon")
    ap.add_argument("--query", required=True, help='search term, e.g. "section 68"')
    ap.add_argument("--max", type=int, default=50, help="max orders to ingest")
    ap.add_argument("--fromdate", help="DD-MM-YYYY")
    ap.add_argument("--todate", help="DD-MM-YYYY")
    a = ap.parse_args()
    run(a.query, a.max, a.fromdate, a.todate)
