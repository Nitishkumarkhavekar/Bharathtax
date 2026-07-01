"""Income Tax Department (incometaxindia.gov.in) crawler — circulars & notifications.

The site is Akamai-bot-protected: plain HTTP/headless = 403. A *non-headless*
real browser on a residential connection passes the challenge, so we drive one
with Playwright, then replay the site's own Liferay search API
(POST /o/search/v1.0/search, paginated JSON) through that authenticated session
and download each document's PDF. ~1,378 circulars + the full notification set.

Runs on the HOST (needs a display for the visible browser), writing into
data/manual/income_tax/{circulars,notifications}/.  Run:
    python scripts/crawl_itd.py [circulars|notifications|all]
A Chromium window will open and stay up while it works — that's expected.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright

BASE = "https://www.incometaxindia.gov.in"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
ROOT = Path("data/manual/income_tax")
PDF_URL = re.compile(r"^/documents/d/guest/[a-z0-9._-]+-pdf$", re.I)  # the doc PDFs, not -png "evidence"
PAGE_SIZE = 50
PAUSE = 0.4
# Akamai gates document downloads on real-navigation headers — a bare fetch 403s.
DL_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/pdf,*/*",
    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "same-origin", "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

SECTIONS = {
    "circulars":     (f"{BASE}/circulars",     "circulars",     "circular"),
    "notifications": (f"{BASE}/notifications", "notifications", "notification"),
}


def _safe_goto(page, url, **kw):
    """Navigate with retries — survives transient network blips (ERR_NETWORK_CHANGED)."""
    last = None
    for attempt in range(5):
        try:
            return page.goto(url, **kw)
        except Exception as e:
            last = e
            print(f"  goto retry {attempt + 1}/5: {str(e)[:60]}")
            try:
                page.wait_for_timeout(4000)
            except Exception:
                pass
    raise last


def _pdf_url(item) -> str | None:
    """Find the document PDF friendly-URL inside an API item (recursively)."""
    found: list[str] = []

    def walk(o):
        if isinstance(o, str):
            if PDF_URL.match(o):
                found.append(o)
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(item)
    return found[0] if found else None


def _number(item) -> str:
    for f in item.get("embedded", {}).get("contentFields", []):
        if f.get("name") == "circularNotificationNumber":
            return f.get("contentFieldValue", {}).get("data", "")
    return ""


def crawl_section(ctx, page, key: str) -> int:
    page_url, dest, dtype = SECTIONS[key]
    captured: dict = {}

    def on_req(r):
        if "/o/search/v1.0/search" in r.url and r.method == "POST" and "body" not in captured:
            captured["body"] = r.post_data
    page.on("request", on_req)

    print(f"\n=== {key}: loading {page_url} (passing Akamai) ===")
    _safe_goto(page, page_url, wait_until="networkidle", timeout=90000)
    page.wait_for_timeout(7000)
    if "Access Denied" in page.content():
        print("  BLOCKED — Akamai denied even the real browser."); return 0
    if "body" not in captured:
        print("  could not capture the search API body."); return 0

    body = captured["body"]
    outdir = ROOT / dest
    outdir.mkdir(parents=True, exist_ok=True)

    def api_post(page_no):
        """POST one search page with retries; return json or None."""
        api = f"{BASE}/o/search/v1.0/search?nestedFields=embedded&page={page_no}&pageSize={PAGE_SIZE}"
        for attempt in range(4):
            try:
                r = ctx.request.post(api, data=body, headers={"Content-Type": "application/json"})
                if r.status == 200:
                    return r.json()
            except Exception as e:
                if attempt == 0:
                    print(f"  page {page_no} retry: {str(e)[:50]}")
            page.wait_for_timeout(3000)
        return None

    first = api_post(1)
    if not first:
        print("  page 1 failed after retries."); return 0
    total = first.get("totalCount")
    last_page = int(first.get("lastPage") or 1)
    print(f"  {total} items across {last_page} pages")
    got = 0
    for page_no in range(1, last_page + 1):
        j = first if page_no == 1 else api_post(page_no)
        if not j:
            print(f"  page {page_no}: failed after retries — skipping (re-run fills gaps)"); continue
        items = j.get("items", []) or []
        for it in items:
            url = _pdf_url(it)
            if not url:
                continue
            slug = url.rsplit("/", 1)[-1]
            dest_f = outdir / f"{slug}.pdf"
            if dest_f.exists() and dest_f.stat().st_size > 0:
                continue
            try:
                resp = ctx.request.get(urljoin(BASE, url),
                                       headers={**DL_HEADERS, "Referer": page_url})
                data = resp.body()
                if not data[:4] == b"%PDF":
                    continue
                dest_f.write_bytes(data)
                dest_f.with_suffix(".pdf.meta.json").write_text(json.dumps({
                    "title": _number(it) or slug, "source_url": urljoin(BASE, url),
                    "source_host": "incometaxindia.gov.in", "doc_type": dtype,
                    "date": it.get("dateCreated"),
                }, indent=2), encoding="utf-8")
                got += 1
                if got % 10 == 0 or got <= 3:
                    print(f"  [{dtype} {got}/{total}] {slug}")
                time.sleep(PAUSE)
            except Exception as e:
                print(f"  err {slug}: {str(e)[:70]}")
    print(f"  {key}: downloaded {got} (of ~{total})")
    return got


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    keys = list(SECTIONS) if which == "all" else [which]
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        ctx = b.new_context(user_agent=UA, viewport={"width": 1366, "height": 768})
        page = ctx.new_page()
        # warm-up: hit the homepage once so Akamai issues clearance
        _safe_goto(page, BASE, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(3000)
        total = sum(crawl_section(ctx, page, k) for k in keys)
        print(f"\nDONE. total documents downloaded: {total}")
        b.close()


if __name__ == "__main__":
    main()
