"""Harvest the Finance Bill *Memorandum* and *Notes on Clauses* from incometaxindia.gov.in.

These are the government's OWN clause-by-clause explanation of every Finance Act —
the Memorandum ("Memorandum Explaining the Provisions in the Finance Bill", organised
by subject with a trailing "[Clause N]" reference per topic) and the Notes on Clauses
(one note per Bill clause, stating which section it amends and why). They are the
cheapest legitimate way to close the "legislative intent / commentary" gap without
touching copyrighted commentary.

The ITD site serves them via the Liferay search API (blueprint FINANCE_BILLS_BP_ERC,
keyed by year_id). Two content modes:
  * older years (~2010 and earlier): full text inline in `documentContent` (HTML)
  * recent years: `documentContent` empty, real content only in a `reportFile` PDF
    at /documents/d/guest/<slug>-pdf  (Akamai blocks API fetches of that path, so we
    download it with an IN-PAGE fetch() that carries the real browser TLS/session)

We split each into @@SECTION units for the `act_sections` parser (unit_label="Clause"):
  * Notes  -> one unit per "Clause N" note        (cite: 'Notes on Clauses, Finance Bill 2026 > Clause 3')
  * Memo   -> one unit per topic (ends at "[Clause N]")  (cite: 'Memorandum, Finance Bill 2026 > Clause 31')

Run (HOST, a Chromium window opens):  python scripts/crawl_finance_bills.py
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
OUT = Path("data/manual/income_tax/finance_bills")
BLUEPRINT = "FINANCE_BILLS_BP_ERC"

# Year taxonomy (shared with the acts/circulars crawlers).
YEAR_IDS = {
    "2026": 13590315, "2025": 38332, "2024": 38326, "2023": 38323, "2022": 38320,
    "2021": 38317, "2020": 38314, "2019": 38305, "2018": 38302, "2017": 38299,
    "2016": 38296, "2015": 38293, "2014": 38290, "2013": 38287, "2012": 38284,
    "2011": 38281, "2010": 38278, "2009": 38275, "2008": 38272, "2007": 38269,
    "2006": 38266, "2005": 38263, "2004": 38260, "2003": 38257, "2002": 38254,
    "2001": 38251, "2000": 38248, "1999": 38245, "1998": 38242, "1997": 38239,
}

_STYLE = re.compile(r"<style[^>]*>.*?</style>", re.I | re.S)
_TAG = re.compile(r"<[^>]+>")
# in-page fetch: real browser network stack -> passes Akamai (ctx.request is blocked)
_FETCH_JS = """async(u)=>{const r=await fetch(u,{credentials:'include'});
const b=await r.arrayBuffer();let s='';const a=new Uint8Array(b);
for(let i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);
return {status:r.status,b64:btoa(s)};}"""


def clean(t: str) -> str:
    """Strip HTML + leaked Liferay structured-content noise (same artifacts as DTAAs)."""
    if not t:
        return ""
    t = _STYLE.sub(" ", t)
    t = _TAG.sub(" ", t)
    t = re.sub(r"\d+;#", " ", t)                         # "398;#Budget|uuid" nav refs
    t = re.sub(r"\|[0-9a-f]{8}-[0-9a-f-]+", " ", t)      # "|<uuid>"
    t = re.sub(r"\\[A-Za-z][\\A-Za-z0-9 ()._-]*", " ", t)  # "\FinanceBills\...HTMLFiles\..."
    t = re.sub(r"\b\d{9,}\b", " ", t)                    # long content ids (107010000000330509)
    t = t.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    t = re.sub(r"[ \t ]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()


def _field(it: dict, name: str):
    for f in it.get("embedded", {}).get("contentFields", []):
        if f.get("name") == name:
            return f.get("contentFieldValue", {})
    return {}


def pdf_text(raw: bytes) -> str:
    d = fitz.open(stream=raw, filetype="pdf")
    t = "".join(p.get_text() for p in d)
    d.close()
    # de-wrap PDF line breaks that split sentences mid-line, keep paragraph gaps
    t = re.sub(r"\S*[^\x00-\x7F]{2,}\S*", " ", t)       # drop font-encoded watermark junk (non-ASCII glyph runs)
    t = re.sub(r"[ \t]*\n[ \t]*\n[ \t]*", "\n\n", t)
    t = re.sub(r"(?<![.\n])\n(?!\n)", " ", t)            # join wrapped lines
    t = re.sub(r"[ \t]+", " ", t)
    return t.strip()


# ---- split into @@SECTION units ------------------------------------------------
# A note opens a new sentence: preceded by '.'/';'/newline/start, never by a letter
# (so inline cross-refs like "read with Clause 5" and "sub-Clause" don't false-split).
# Anchoring on sentence-end (not newline) survives PDF line-unwrapping.
_NOTE = re.compile(r"(?:(?<=[.;])|(?<=\n)|^)\s*(?=Clause\s+\d+[A-Z]?\b)")
_CLAUSE_NUM = re.compile(r"(?is)^\s*Clause\s+(\d+[A-Z]?)\b")
_MEMO_REF = re.compile(r"\[\s*Clauses?\s+[^\]]*\]")       # trailing "[Clause 31]" per topic
_HEAD = re.compile(r"(?m)^\s*([A-Z])\.\s+[A-Z][A-Za-z]")  # lettered head "A. RATES..."


def split_notes(text: str) -> list[tuple[str, str, str, str]]:
    """(num, chapter, label, body) per 'Clause N' note."""
    parts = [p.strip() for p in _NOTE.split(text) if p.strip()]
    units = []
    for p in parts:
        m = _CLAUSE_NUM.match(p)
        if not m:
            continue
        units.append((m.group(1), "", f"Clause {m.group(1)}", p))
    return units


def split_memo(text: str) -> list[tuple[str, str, str]]:
    """One unit per topic; a topic ends at its trailing '[Clause N]' reference."""
    units, head, pos, k = [], "", 0, 0
    for m in _MEMO_REF.finditer(text):
        seg = text[pos:m.end()].strip()
        pos = m.end()
        if len(seg) < 40:
            continue
        hm = None
        for hm in _HEAD.finditer(seg):
            pass
        if hm:
            head = hm.group(1)
        nums = re.findall(r"\d+", m.group(0))            # "[Clauses 2, 3 and ...]" -> "2,3"
        num = ",".join(nums) or str(k + 1)
        # title = first substantive line, minus any leading lettered-head prefix (avoids "B. B. ...")
        title = next((ln.strip() for ln in seg.splitlines() if len(ln.strip()) > 8), seg[:60])
        title = re.sub(r"^[A-Z]\.\s+", "", title)[:70]
        k += 1
        units.append((num, head, title, seg))
    if len(units) < 2:  # no clause-ref structure -> window it (avoid a giant parent chunk)
        units = _window(text)
    return units


def _window(text: str, size: int = 1800) -> list[tuple[str, str, str, str]]:
    words, out, i, k = text.split(), [], 0, 0
    while i < len(words):
        k += 1
        chunk = " ".join(words[i:i + size])
        out.append((str(k), "", f"Part {k}", chunk))
        i += size
    return out


def write_doc(slug: str, title: str, units: list[tuple[str, str, str, str]], src_url: str) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    lines = [f"{title}\n"]
    for num, chapter, label, body in units:
        head = f"@@SECTION {num} | {chapter} | {label}".rstrip(" |")
        lines.append(f"\n{head}\n{body}\n")
    dest = OUT / f"{slug}.txt"
    dest.write_text("\n".join(lines), encoding="utf-8")
    dest.with_suffix(".txt.meta.json").write_text(json.dumps({
        "title": title, "source_host": "incometaxindia.gov.in",
        "source_url": src_url, "doc_type": "finance_bill_explanatory"}, indent=2), encoding="utf-8")
    return len(units)


# which items we want, and how to slug/split them
WANT = [
    (re.compile(r"notes\s+on\s+clauses", re.I), "notes_on_clauses", "Notes on Clauses, Finance Bill", split_notes),
    (re.compile(r"memorandum", re.I),           "memorandum",       "Memorandum, Finance Bill",       split_memo),
]


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        ctx = b.new_context(user_agent=UA, viewport={"width": 1366, "height": 768})
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(2000)
        page.goto(f"{BASE}/finance-bills", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)

        def fetch_pdf(url: str) -> bytes | None:
            for _ in range(3):
                try:
                    r = page.evaluate(_FETCH_JS, url)
                    if r.get("status") == 200 and r.get("b64"):
                        return base64.b64decode(r["b64"])
                except Exception:
                    pass
                page.wait_for_timeout(1500)
            return None

        docs = units_total = 0
        for year, yid in YEAR_IDS.items():
            body = json.dumps({"attributes": {
                "search.empty.search": True,
                "search.experiences.blueprint.external.reference.code": BLUEPRINT,
                "search.experiences.year_id": yid}})
            r = ctx.request.post(f"{BASE}/o/search/v1.0/search?nestedFields=embedded&page=1&pageSize=20",
                                 data=body, headers={"Content-Type": "application/json"})
            items = (r.json().get("items") or []) if r.status == 200 else []
            if not items:
                continue
            for want_re, base_slug, base_title, splitter in WANT:
                it = next((x for x in items if want_re.search(x.get("title", ""))), None)
                if not it:
                    continue
                dc = _field(it, "documentContent").get("data", "") or ""
                text = clean(dc)
                if len(text) < 500:                      # PDF-only year -> download via in-page fetch
                    doc = _field(it, "reportFile").get("document", {}) or {}
                    cu = doc.get("contentUrl", "")
                    raw = fetch_pdf(BASE + cu) if cu else None
                    text = pdf_text(raw) if raw else ""
                if len(text) < 500:
                    print(f"  {year} {base_slug}: SKIP (no content)")
                    continue
                units = splitter(text)
                if not units:
                    continue
                n = write_doc(f"{base_slug}_{year}", f"{base_title} {year}", units, f"{BASE}/finance-bills")
                docs += 1; units_total += n
                print(f"  {year} {base_slug}: {n} units ({len(text)} chars)")

        print(f"\nDONE. {docs} documents, {units_total} clause-units -> {OUT}")
        b.close()


if __name__ == "__main__":
    main()
