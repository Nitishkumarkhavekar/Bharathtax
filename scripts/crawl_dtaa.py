"""Harvest India's tax treaties (DTAAs) from incometaxindia.gov.in.

The ITD site serves treaties via its Liferay search API (blueprint
DTAA_FULL_TREATY_BP_ERC), each with the full treaty text inline in `documentContent`
— 173 items (comprehensive DTAAs, limited agreements, TIEAs, other agreements).
We clean the HTML, split each treaty into Articles, and write @@SECTION-delimited
files for the `treaty_sections` parser (cites as 'India-Germany DTAA > Article 12').

Run (host, browser opens):  python scripts/crawl_dtaa.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://www.incometaxindia.gov.in"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
OUT = Path("data/manual/income_tax/dtaa")
PAGE_SIZE = 100
BODY = json.dumps({"attributes": {
    "search.empty.search": True,
    "search.experiences.blueprint.external.reference.code": "DTAA_FULL_TREATY_BP_ERC",
    "search.experiences.dtaa_active": True,
}})

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_STYLE = re.compile(r"<style[^>]*>.*?</style>", re.I | re.S)
_CSSBLOCK = re.compile(r"@media[^{]*\{[^{}]*\{[^}]*\}[^}]*\}|\.[A-Za-z_-]+\s*\{[^}]*\}", re.S)
_TAG = re.compile(r"<[^>]+>")
_CRUMB = re.compile(rf"[\w .,()&-]{{0,60}}\|{_UUID}")
_LIFERAY_REF = re.compile(r"\d+;#\d+\|[0-9a-f-]+")  # "352;#1975|05612..." nav artifacts
_ARTICLE = re.compile(r"(?im)^\s*ARTICLE\s+([IVXLC0-9]+[A-Z]?)\b")


def clean(html: str) -> str:
    if not html:
        return ""
    t = _STYLE.sub(" ", html)
    t = _CSSBLOCK.sub(" ", t)
    t = _TAG.sub(" ", t)
    t = _CRUMB.sub(" ", t)
    t = _LIFERAY_REF.sub(" ", t)
    # strip leaked Liferay structured-content metadata (category refs, CMS paths, ids, timestamps)
    t = re.sub(r"\d+;#", " ", t)                       # "380;#" multi-value markers
    t = re.sub(r";#", " ", t)
    t = re.sub(r"\\[A-Za-z][\\A-Za-z0-9 ()._-]*", " ", t)  # "\DTAA\WHOLETREATY\..." paths
    t = re.sub(r"\d{4}-\d{2}-\d{2}T[\d:.]+Z?", " ", t)  # ISO timestamps
    t = re.sub(r"\b\d{9,}\b", " ", t)                  # long content ids
    t = re.sub(r"\b\d+\.\d{5,}\b", " ", t)             # stray floats (42000.0000000000)
    t = t.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    t = re.sub(r"[ \t ]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()


def _field(item, name):
    for f in item.get("embedded", {}).get("contentFields", []):
        if f.get("name") == name:
            return f.get("contentFieldValue", {}).get("data", "") or ""
    return ""


def write_treaty(title: str, text: str) -> int:
    """Split into Articles (fallback: whole treaty) and write a @@SECTION file."""
    OUT.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")[:60] or "treaty"
    lines = [f"{title}\n"]
    marks = list(_ARTICLE.finditer(text))
    units = 0
    if len(marks) >= 3:  # real article structure
        for i, m in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            body = text[m.start():end].strip()
            if body:
                lines.append(f"\n@@SECTION {m.group(1)} |  | Article {m.group(1)}\n{body}\n")
                units += 1
    else:  # no clear articles -> one unit, parser will window it
        lines.append(f"\n@@SECTION 1 |  | {title[:60]}\n{text}\n")
        units = 1
    dest = OUT / f"{slug}.txt"
    dest.write_text("\n".join(lines), encoding="utf-8")
    dest.with_suffix(".txt.meta.json").write_text(json.dumps({
        "title": title, "source_host": "incometaxindia.gov.in",
        "source_url": f"{BASE}/dtaa", "doc_type": "treaty"}, indent=2), encoding="utf-8")
    return units


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        ctx = b.new_context(user_agent=UA, viewport={"width": 1366, "height": 768})
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(3000)

        def api(pg_no):
            for _ in range(4):
                try:
                    r = ctx.request.post(f"{BASE}/o/search/v1.0/search?nestedFields=embedded&page={pg_no}&pageSize={PAGE_SIZE}",
                                         data=BODY, headers={"Content-Type": "application/json"})
                    if r.status == 200:
                        return r.json()
                except Exception:
                    pass
                page.wait_for_timeout(2500)
            return None

        j = api(1)
        last = int(j.get("lastPage") or 1)
        items = list(j.get("items") or [])
        for pg in range(2, last + 1):
            jj = api(pg)
            if jj:
                items += jj.get("items") or []
        print(f"=== {len(items)} treaties ===")

        total_units = treaties = 0
        for it in items:
            title = (it.get("title", "") or "").replace(" : ", " - ").strip()
            text = clean(_field(it, "documentContent"))
            if len(text) < 100:
                continue
            n = write_treaty(f"India - {title}" if not title.lower().startswith("india") else title, text)
            total_units += n; treaties += 1
        print(f"DONE. {treaties} treaties, {total_units} article-units -> {OUT}")
        b.close()


if __name__ == "__main__":
    main()
