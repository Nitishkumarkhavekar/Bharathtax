"""India Code (indiacode.nic.in) acquisition crawler — the authoritative, free,
bot-friendly source for central statutes: the Income-tax Act, every Finance Act,
and the Taxation Laws (Amendment) Acts.

DSpace flow:  simple-search?query=... -> /handle/123456789/NNNN detail pages ->
/bitstream/.../*.pdf.  Polite (rate-limited), idempotent (skips existing),
writes a provenance sidecar next to each PDF so the ingest pipeline can cite it.

Run (in the worker/api container, /data is mounted):
    python -m app.ingestion.acquire.indiacode
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

BASE = "https://www.indiacode.nic.in"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36"
OUT = Path("/data/manual/income_tax/statutes")
RATE = 3.0          # seconds between requests (polite)
MAX_PER_QUERY = 60  # cap per search to avoid runaway

# Targeted queries for the income-tax statutory suite.
QUERIES = [
    "income-tax act 1961",
    "finance act",
    "taxation laws amendment act",
    "direct tax vivad",
    "black money undisclosed foreign income",
]
# Accept only the CENTRAL direct-tax statutory suite...
TITLE_OK = re.compile(
    r"(income.?tax act|finance act|finance \(no|taxation laws \(amendment|"
    r"taxation laws \(continuation|direct tax vivad|black money|income declaration scheme|"
    r"wealth.?tax|gift.?tax)", re.I)
# ...and reject STATE acts (India Code's search mixes them in: "Assam Finance Act"…).
STATE_BLOCK = re.compile(
    r"\b(andhra|arunachal|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal|jharkhand|"
    r"karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|"
    r"orissa|punjab|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|"
    r"west bengal|delhi|jammu|kashmir|puducherry|pondicherry|hyderabad|mysore|madras|bombay|"
    r"travancore|cochin|saurashtra|patiala)\b", re.I)


def _client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": UA}, timeout=45.0, follow_redirects=True)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80]


def search_handles(client: httpx.Client, query: str) -> list[str]:
    r = client.get(f"{BASE}/simple-search", params={"query": query, "rpp": MAX_PER_QUERY})
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    handles = []
    for a in soup.select("a[href*='/handle/123456789/']"):
        m = re.search(r"/handle/123456789/\d+", a.get("href", ""))
        if m and m.group(0) not in handles:
            handles.append(m.group(0))
    return handles


def resolve_pdf(client: httpx.Client, handle: str) -> tuple[str, str] | None:
    """Return (title, pdf_url) for a document handle, or None."""
    r = client.get(f"{BASE}{handle}")
    if r.status_code != 200:
        return None
    soup = BeautifulSoup(r.text, "lxml")
    title = (soup.find("h2") or soup.find("title"))
    title = title.get_text(strip=True) if title else handle
    link = soup.select_one("a[href*='/bitstream/'][href$='.pdf'], a[href*='/bitstream/'][href*='.pdf']")
    if not link:
        return None
    return title, urljoin(BASE, link.get("href"))


def run() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    downloaded = 0
    with _client() as client:
        for q in QUERIES:
            print(f"\n# search: {q!r}")
            try:
                handles = search_handles(client, q)
            except Exception as e:
                print("  search failed:", e)
                continue
            time.sleep(RATE)
            for h in handles:
                if h in seen:
                    continue
                seen.add(h)
                try:
                    info = resolve_pdf(client, h)
                    time.sleep(RATE)
                    if not info:
                        continue
                    title, pdf_url = info
                    if not TITLE_OK.search(title) or STATE_BLOCK.search(title):
                        print(f"  skip (off-topic/state): {title[:55]}")
                        continue
                    dest = OUT / f"{_slug(title)}.pdf"
                    if dest.exists() and dest.stat().st_size > 0:
                        print(f"  skip (have): {title[:60]}")
                        continue
                    data = client.get(pdf_url).content
                    if not data.startswith(b"%PDF"):
                        print(f"  not a pdf: {title[:60]}")
                        continue
                    dest.write_bytes(data)
                    dest.with_suffix(".pdf.meta.json").write_text(json.dumps({
                        "title": title, "source_url": pdf_url, "source_host": "indiacode.nic.in",
                        "doc_type": "act", "handle": h,
                    }, indent=2), encoding="utf-8")
                    downloaded += 1
                    print(f"  [{downloaded}] {title[:60]}  ({len(data)//1024} KB)")
                    time.sleep(RATE)
                except Exception as e:
                    print("  error:", str(e)[:100])
    print(f"\nDONE. downloaded {downloaded} statute PDF(s) into {OUT}")


if __name__ == "__main__":
    run()
