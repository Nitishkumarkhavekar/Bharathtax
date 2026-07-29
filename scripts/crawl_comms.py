"""Harvest CBDT taxpayer communications from incometaxindia.gov.in — FAQs and Press
Releases (Wave 2 #4). Two sub-sources, one crawler:

  faqs   : the official CBDT FAQ set (blueprint FAQ_INDEXER_BP_ERC, structure 35993).
           Each item = {selectChapter (topic), title (question), description (answer)}.
           High RAG value: plain-language, grounded Q&A. Grouped by chapter, one
           @@SECTION per question -> cites 'CBDT FAQ: <chapter> > Q 3'.
  press  : CBDT Press Releases (blueprint MISCELLANEOUS_BP_ERC, structure_key
           PRESS_RELEASE). PDF-only recent years (in-page fetch bypasses Akamai);
           inline documentContent for older ones.

NOTE: CBDT *Instructions* are NOT exposed as a distinct structure on this site (the
circular blueprint carries only CIRCULAR_KEY + NOTIFICATION_KEY, both already in the
corpus) — deferred, no clean primary source here.

Run (HOST, Chromium opens):
    python scripts/crawl_comms.py faqs
    python scripts/crawl_comms.py press
"""
from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF
from playwright.sync_api import sync_playwright

BASE = "https://www.incometaxindia.gov.in"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
OUT_FAQ = Path("data/manual/income_tax/faqs")
OUT_PRESS = Path("data/manual/income_tax/press_releases")
PAGE_SIZE = 10   # server caps/garbles larger page sizes; pageSize=10 pages linearly

# Year taxonomy (shared with the acts/finance-bill crawlers) — press releases are
# sharded by year_id so pagination stays shallow (the search API windows deep pages).
YEAR_IDS = {
    "2026": 13590315, "2025": 38332, "2024": 38326, "2023": 38323, "2022": 38320,
    "2021": 38317, "2020": 38314, "2019": 38305, "2018": 38302, "2017": 38299,
    "2016": 38296, "2015": 38293, "2014": 38290, "2013": 38287, "2012": 38284,
    "2011": 38281, "2010": 38278, "2009": 38275, "2008": 38272, "2007": 38269,
    "2006": 38266, "2005": 38263, "2004": 38260, "2003": 38257, "2002": 38254,
    "2001": 38251, "2000": 38248, "1999": 38245, "1998": 38242, "1997": 38239,
}

_STYLE = re.compile(r"<style[^>]*>.*?</style>", re.I | re.S)
_SCRIPT = re.compile(r"<script[^>]*>.*?</script>", re.I | re.S)
_TAG = re.compile(r"<[^>]+>")
_FETCH_JS = """async(u)=>{const r=await fetch(u,{credentials:'include'});
const b=await r.arrayBuffer();let s='';const a=new Uint8Array(b);
for(let i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);
return {status:r.status,b64:btoa(s)};}"""


def clean(t: str) -> str:
    if not t:
        return ""
    t = _STYLE.sub(" ", t)
    t = _SCRIPT.sub(" ", t)
    t = re.sub(r"<!doctype.*?>", " ", t, flags=re.I | re.S)
    t = _TAG.sub(" ", t)
    t = re.sub(r"\d+;#", " ", t)
    t = re.sub(r"\|[0-9a-f]{8}-[0-9a-f-]+", " ", t)
    t = re.sub(r"\\[A-Za-z][\\A-Za-z0-9 ()._-]*", " ", t)
    t = re.sub(r"\b\d{9,}\b", " ", t)
    t = re.sub(r"\S*[^\x00-\x7F]{2,}\S*", " ", t)         # font-encoded glyph runs
    t = (t.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
         .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'"))
    t = re.sub(r"[ \t ]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()


def _field(it: dict, name: str):
    for f in it.get("embedded", {}).get("contentFields", []):
        if f.get("name") == name:
            return f.get("contentFieldValue", {})
    return {}


def _fdata(it, name):
    return _field(it, name).get("data", "") or ""


def _slug(t: str, n: int = 60) -> str:
    return re.sub(r"[^a-z0-9]+", "_", t.lower()).strip("_")[:n] or "doc"


def harvest(ctx, page, attrs: dict) -> list[dict]:
    body = json.dumps({"attributes": {"search.empty.search": True, **attrs}})

    def api(pg_no):
        for _ in range(4):
            try:
                r = ctx.request.post(
                    f"{BASE}/o/search/v1.0/search?nestedFields=embedded&page={pg_no}&pageSize={PAGE_SIZE}",
                    data=body, headers={"Content-Type": "application/json"})
                if r.status == 200:
                    return r.json()
            except Exception:
                pass
            page.wait_for_timeout(2000)
        return None

    j = api(1)
    if not j:
        print("  harvest: page 1 returned nothing"); return []
    total = int(j.get("totalCount") or 0)
    key = lambda it: it.get("itemURL") or it.get("title")
    by_id: dict = {}
    for it in (j.get("items") or []):
        by_id[key(it)] = it
    print(f"  harvest: total={total}", flush=True)
    # page count from lastPage is unreliable when the server caps items/page below the
    # requested size, so keep paging until we've collected `total` unique ids (or a page
    # yields nothing new / a hard page ceiling).
    pg = 1
    while len(by_id) < total and pg < 200:
        pg += 1
        jj = api(pg)
        got = (jj or {}).get("items") or []
        if not got:
            break
        before = len(by_id)
        for it in got:
            by_id[key(it)] = it
        if len(by_id) == before:      # no new ids -> pagination exhausted
            break
        if pg % 10 == 0:
            print(f"  page {pg} -> {len(by_id)}/{total} unique", flush=True)
    print(f"  collected {len(by_id)}/{total} unique items", flush=True)
    return list(by_id.values())


def write_grouped_faqs(groups: dict[str, list[tuple[str, str]]]) -> tuple[int, int]:
    OUT_FAQ.mkdir(parents=True, exist_ok=True)
    docs = units = 0
    for chapter, qas in groups.items():
        title = f"CBDT FAQ: {chapter}"
        lines = [f"{title}\n"]
        for i, (q, a) in enumerate(qas, 1):
            lines.append(f"\n@@SECTION {i} |  | {q[:90]}\nQ: {q}\nA: {a}\n")
        dest = OUT_FAQ / f"{_slug(chapter)}.txt"
        dest.write_text("\n".join(lines), encoding="utf-8")
        dest.with_suffix(".txt.meta.json").write_text(json.dumps({
            "title": title, "source_host": "incometaxindia.gov.in",
            "source_url": f"{BASE}/web/guest/frequently-asked-questions",
            "doc_type": "faq"}, indent=2), encoding="utf-8")
        docs += 1; units += len(qas)
    return docs, units


def do_faqs(ctx, page):
    items = harvest(ctx, page, {
        "search.experiences.blueprint.external.reference.code": "FAQ_INDEXER_BP_ERC",
        "search.experiences.structure_key": "FAQ_CHAPTER_KEY",
        "search.experiences.selected_structure_id": "35993"})
    print(f"=== {len(items)} FAQ items ===")
    groups: dict[str, list[tuple[str, str]]] = {}
    for it in items:
        q = clean(it.get("title", ""))
        a = clean(_fdata(it, "description"))
        chapter = clean(_fdata(it, "selectChapter")) or "General"
        if len(q) < 5 or len(a) < 10:
            continue
        groups.setdefault(chapter, []).append((q, a))
    docs, units = write_grouped_faqs(groups)
    print(f"DONE. {docs} FAQ chapters, {units} Q&A units -> {OUT_FAQ}")


def do_press(ctx, page):
    # 1) gather item metadata across all years (shallow per-year pagination), dedupe by title
    by_title: dict = {}
    for year, yid in YEAR_IDS.items():
        items = harvest(ctx, page, {
            "search.experiences.blueprint.external.reference.code": "MISCELLANEOUS_BP_ERC",
            "search.experiences.structure_key": "PRESS_RELEASE",
            "search.experiences.year_id": yid})
        for it in items:
            t = (it.get("title", "") or "").strip()
            if t and t not in by_title:
                it["_year"] = year
                by_title[t] = it
        print(f"  year {year}: cumulative {len(by_title)} unique press releases", flush=True)
    items = list(by_title.values())
    print(f"=== {len(items)} unique press releases to fetch ===", flush=True)

    def fetch_pdf(url):
        for _ in range(3):
            try:
                r = page.evaluate(_FETCH_JS, url)
                if r.get("status") == 200 and r.get("b64"):
                    return base64.b64decode(r["b64"])
            except Exception:
                pass
            page.wait_for_timeout(1200)
        return None

    # 2) fetch each PR's text (inline if present, else its PDF). Resume-safe: skip files
    #    already on disk so a crash mid-run continues where it left off on re-run.
    OUT_PRESS.mkdir(parents=True, exist_ok=True)
    written = skipped = 0
    for i, it in enumerate(items, 1):
        title = (it.get("title", "") or "").strip()
        slug = _slug(title) + "_" + it.get("_year", "")
        dest = OUT_PRESS / f"{slug}.txt"
        if dest.exists():
            skipped += 1; continue
        text = clean(_fdata(it, "documentContent"))
        if len(text) < 200:
            doc = _field(it, "reportFile").get("document", {}) or {}
            cu = doc.get("contentUrl", "")
            raw = fetch_pdf(BASE + cu) if cu else None
            if raw:
                try:
                    d = fitz.open(stream=raw, filetype="pdf")
                    text = clean("".join(p.get_text() for p in d)); d.close()
                except Exception:
                    text = ""
        if len(text) < 120:
            continue
        dest.write_text(f"{title}\n\n{text}\n", encoding="utf-8")
        dest.with_suffix(".txt.meta.json").write_text(json.dumps({
            "title": title, "source_host": "incometaxindia.gov.in", "year": it.get("_year", ""),
            "source_url": f"{BASE}/press-release", "doc_type": "press_release"}, indent=2), encoding="utf-8")
        written += 1
        if written % 50 == 0:
            print(f"  fetched {i}/{len(items)} ({written} written, {skipped} pre-existing)", flush=True)
    print(f"DONE. {written} new press releases (+{skipped} already on disk) -> {OUT_PRESS}", flush=True)


def main():
    what = sys.argv[1] if len(sys.argv) > 1 else "faqs"
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        ctx = b.new_context(user_agent=UA, viewport={"width": 1366, "height": 768})
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(2000)
        if what == "press":
            page.goto(f"{BASE}/press-release", wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(2000)
            do_press(ctx, page)
        else:
            do_faqs(ctx, page)
        b.close()


if __name__ == "__main__":
    main()
