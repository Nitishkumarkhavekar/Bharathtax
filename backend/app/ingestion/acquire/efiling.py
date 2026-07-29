"""e-Filing portal (incometax.gov.in) acquisition crawler — circulars,
notifications, instructions, orders & press releases.

The portal is Drupal (server-rendered), so plain HTTP works — no headless browser
needed (and the legacy incometaxindia.gov.in is Akamai-blocked, so we use this).
The "Latest News" feed is year-filterable (?year=YYYY) and links straight to the
document PDFs under /sites/default/files/YYYY-MM/...pdf.

Note: this feed is the *highlighted* subset, not the full historical archive
(that's e-Gazette / the blocked site — a later task). Still legal + useful.

Run:  python -m app.ingestion.acquire.efiling
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from urllib.parse import urljoin, unquote

import httpx
from bs4 import BeautifulSoup

BASE = "https://www.incometax.gov.in"
NEWS = f"{BASE}/iec/foportal/latest-news"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36"
ROOT = Path("/data/manual/income_tax")
YEARS = list(range(2026, 2011, -1))   # 2012..2026
RATE = 2.0

# classify a PDF by its filename/link text -> (subfolder, doc_type) or None to skip
RULES = [
    (re.compile(r"circular", re.I),       ("circulars", "circular")),
    (re.compile(r"notification", re.I),   ("notifications", "notification")),
    (re.compile(r"instruction", re.I),    ("instructions", "instruction")),
    (re.compile(r"\border\b|\bom\b|office[ _-]?memorandum", re.I), ("orders", "order")),
    (re.compile(r"press[ _-]?release", re.I), ("press_releases", "press_release")),
]
SKIP = re.compile(r"vision|mission|charter|brochure|booklet|form-?\d|itr|utility", re.I)


def _client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": UA}, timeout=45.0, follow_redirects=True)


def classify(name: str) -> tuple[str, str] | None:
    if SKIP.search(name):
        return None
    for pat, dest in RULES:
        if pat.search(name):
            return dest
    return None


def pdf_links(html: str) -> list[tuple[str, str]]:
    """Return (absolute_url, link_text) for every PDF on the page."""
    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if ".pdf" in href.lower():
            out.append((urljoin(BASE, href), a.get_text(" ", strip=True)))
    return out


def run() -> None:
    seen_urls: set[str] = set()
    counts: dict[str, int] = {}
    with _client() as client:
        for yr in YEARS:
            try:
                r = client.get(NEWS, params={"year": yr})
                if r.status_code != 200:
                    continue
            except Exception as e:
                print(f"  year {yr}: fetch failed {e}")
                continue
            links = pdf_links(r.text)
            print(f"# year {yr}: {len(links)} pdf link(s)")
            time.sleep(RATE)
            for url, text in links:
                if url in seen_urls:
                    continue
                seen_urls.add(url)
                fname = unquote(url.rsplit("/", 1)[-1])
                cls = classify(f"{fname} {text}")
                if not cls:
                    continue
                sub, dtype = cls
                dest = ROOT / sub / fname.replace("%20", " ")
                dest.parent.mkdir(parents=True, exist_ok=True)
                if dest.exists() and dest.stat().st_size > 0:
                    continue
                try:
                    data = client.get(url).content
                    time.sleep(RATE)
                    if not data.startswith(b"%PDF"):
                        continue
                    dest.write_bytes(data)
                    dest.with_suffix(dest.suffix + ".meta.json").write_text(json.dumps({
                        "title": text or fname, "source_url": url,
                        "source_host": "incometax.gov.in", "doc_type": dtype, "year": yr,
                    }, indent=2), encoding="utf-8")
                    counts[sub] = counts.get(sub, 0) + 1
                    print(f"  [{dtype}] {fname[:60]}")
                except Exception as e:
                    print(f"  error {fname[:40]}: {str(e)[:60]}")
    print(f"\nDONE. downloaded by type: {counts or '{}'}")


if __name__ == "__main__":
    run()
