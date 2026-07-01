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

# A broad search saturates at ~400 unique results, so we query PER YEAR
# (year_id = Liferay 'Year' taxonomy category). Harvested from the site's own
# dropdown; the Year vocabulary is shared across circulars & notifications.
YEAR_IDS = {
    "2026": 13590315, "2025": 38332, "2024": 38326, "2023": 38323, "2022": 38320,
    "2021": 38317, "2020": 38314, "2019": 38305, "2018": 38302, "2017": 38299,
    "2016": 38296, "2015": 38293, "2014": 38290, "2013": 38287, "2012": 38284,
    "2011": 38281, "2010": 38278, "2009": 38275, "2008": 38272, "2007": 38269,
    "2006": 38266, "2005": 38263, "2004": 38260, "2003": 38257, "2002": 38254,
    "2001": 38251, "2000": 38248, "1999": 38245, "1998": 38242, "1997": 38239,
    "1996": 38236, "1995": 38233, "1994": 38230, "1993": 38227, "1992": 38224,
    "1991": 38221, "1990": 38218, "1989": 38215, "1988": 38212, "1987": 38209,
    "1986": 38206, "1985": 38203, "1984": 38200, "1983": 38197, "1982": 38194,
    "1981": 38191, "1980": 38188, "1979": 38185, "1978": 38182, "1977": 38179,
    "1976": 38176, "1975": 38173, "1974": 38170, "1973": 38167, "1972": 38164,
    "1971": 38161, "1970": 38158, "1969": 38155, "1968": 38152, "1967": 38149,
    "1966": 38146, "1965": 38143, "1964": 38140, "1963": 38137, "1962": 38134,
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


def _html_content(item) -> str | None:
    """Older docs are inline HTML structured-content (no PDF). Return that HTML."""
    for f in item.get("embedded", {}).get("contentFields", []):
        if f.get("name") == "documentContent":
            data = f.get("contentFieldValue", {}).get("data", "") or ""
            if "<" in data and len(data) > 200:   # real HTML body, not an empty field
                return data
    return None


def _sc_id(item) -> str:
    """Structured-content id (stable unique name for the HTML docs)."""
    found = []

    def w(o):
        if isinstance(o, str):
            m = re.search(r"/structured-contents/(\d+)", o)
            if m:
                found.append(m.group(1))
        elif isinstance(o, dict):
            for v in o.values():
                w(v)
        elif isinstance(o, list):
            for v in o:
                w(v)

    w(item)
    return found[0] if found else ""


def crawl_section(ctx, page, key: str, years: set[str] | None = None) -> int:
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

    base = json.loads(captured["body"])
    outdir = ROOT / dest
    outdir.mkdir(parents=True, exist_ok=True)

    def api_post(page_no, body_str):
        """POST one search page with retries; return json or None."""
        api = f"{BASE}/o/search/v1.0/search?nestedFields=embedded&page={page_no}&pageSize={PAGE_SIZE}"
        for attempt in range(4):
            try:
                r = ctx.request.post(api, data=body_str, headers={"Content-Type": "application/json"})
                if r.status == 200:
                    return r.json()
            except Exception as e:
                if attempt == 0:
                    print(f"    page {page_no} retry: {str(e)[:50]}")
            page.wait_for_timeout(3000)
        return None

    def _meta(dest_f, it, url):
        dest_f.with_suffix(dest_f.suffix + ".meta.json").write_text(json.dumps({
            "title": _number(it) or dest_f.stem, "source_url": url,
            "source_host": "incometaxindia.gov.in", "doc_type": dtype, "date": it.get("dateCreated"),
        }, indent=2), encoding="utf-8")

    def download(it, year) -> int:
        # 1) PDF path (newer docs)
        url = _pdf_url(it)
        if url:
            slug = url.rsplit("/", 1)[-1]
            dest_f = outdir / f"{slug}.pdf"
            if dest_f.exists() and dest_f.stat().st_size > 0:
                return 0
            try:
                resp = ctx.request.get(urljoin(BASE, url), headers={**DL_HEADERS, "Referer": page_url})
                data = resp.body()
                if data[:4] != b"%PDF":
                    return 0
                dest_f.write_bytes(data)
                _meta(dest_f, it, urljoin(BASE, url))
                time.sleep(PAUSE)
                return 1
            except Exception as e:
                print(f"    err {slug}: {str(e)[:60]}")
                return 0
        # 2) inline HTML structured-content (older docs, no PDF)
        html = _html_content(it)
        if html:
            sid = _sc_id(it) or str(abs(hash(html)))[:10]
            dest_f = outdir / f"{dtype}-{year}-sc{sid}.html"
            if dest_f.exists() and dest_f.stat().st_size > 0:
                return 0
            dest_f.write_text(html, encoding="utf-8")
            _meta(dest_f, it, f"{BASE}/o/headless-delivery/v1.0/structured-contents/{sid}")
            return 1
        return 0

    got = 0
    year_items = [(y, i) for y, i in YEAR_IDS.items() if not years or y in years]
    for year, yid in year_items:
        b2 = json.loads(json.dumps(base))
        b2["attributes"]["search.experiences.year_id"] = yid
        body_str = json.dumps(b2)
        j = api_post(1, body_str)
        if not j:
            print(f"  {year}: page 1 failed — skipping (re-run fills gaps)"); continue
        yr_total = j.get("totalCount", 0)
        last_page = int(j.get("lastPage") or 1)
        yr_got = sum(download(it, year) for it in (j.get("items") or []))
        for pageno in range(2, last_page + 1):
            jj = api_post(pageno, body_str)
            if jj:
                yr_got += sum(download(it, year) for it in (jj.get("items") or []))
        got += yr_got
        print(f"  {year}: +{yr_got} new (year has {yr_total}) | {key} running total {got}")
    print(f"  {key}: downloaded {got} new")
    return got


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    keys = list(SECTIONS) if which == "all" else [which]
    # Optional 2nd arg = comma-separated years to crawl (a partition for multi-worker
    # parallel runs). Omit to crawl every year. Idempotent, so workers never collide.
    years = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    tag = f" [years {sys.argv[2]}]" if years else ""
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        ctx = b.new_context(user_agent=UA, viewport={"width": 1366, "height": 768})
        page = ctx.new_page()
        # warm-up: hit the homepage once so Akamai issues clearance
        _safe_goto(page, BASE, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(3000)
        total = sum(crawl_section(ctx, page, k, years) for k in keys)
        print(f"\nDONE{tag}. total documents downloaded: {total}")
        b.close()


if __name__ == "__main__":
    main()
