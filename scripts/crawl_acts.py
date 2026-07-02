"""Income Tax Department (incometaxindia.gov.in) — statutory ACTS harvester.

The site serves Acts as *structured sections* via its Liferay search API
(blueprint ACT_SECTIONS_BP_ERC), keyed by act_id + year_id, each section carrying
inline HTML text (documentContent) plus section/chapter metadata. This is far
cleaner than the scanned PDFs — no OCR, real structure. We harvest:

  * Finance Acts (act_id 4209071) for every year — the annual amendment layer
  * Income-tax Act, 2025 (act_id 8325573) — the new Act replacing the 1961 Act

and write one section-delimited text file per act into
data/manual/income_tax/acts_new/, for the `act_sections` parser + pipeline.

Akamai-gated like the circular/notification crawler, so it drives a non-headless
browser and replays the site's own search API through that session.

Run (on the HOST, a Chromium window opens):  python scripts/crawl_acts.py
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://www.incometaxindia.gov.in"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
OUT = Path("data/manual/income_tax/acts_new")
OUT_RULES = Path("data/manual/income_tax/rules_new")
PAGE_SIZE = 100

# Year taxonomy (shared with circulars/notifications) — harvested from the site dropdown.
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

FINANCE_ACT_ID = 4209071          # "Finance Acts" (annual, filter by year_id)
IT_ACT_2025_ID = 8325573          # "Income-tax Act, 2025" (new act; single version)

_UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_STYLE = re.compile(r"<style[^>]*>.*?</style>", re.I | re.S)
_CSSBLOCK = re.compile(r"@media[^{]*\{[^{}]*\{[^}]*\}[^}]*\}|\.[A-Za-z_-]+\s*\{[^}]*\}", re.S)
_TAG = re.compile(r"<[^>]+>")
_CRUMB = re.compile(rf"[\w .,()&-]{{0,60}}\|{_UUID}")   # "Act|<uuid>", "Finance Acts|<uuid>"


def clean(html: str) -> str:
    """Strip HTML/CSS/nav-breadcrumb noise from a section's documentContent."""
    if not html:
        return ""
    t = _STYLE.sub(" ", html)
    t = _CSSBLOCK.sub(" ", t)
    t = _TAG.sub(" ", t)
    t = _CRUMB.sub(" ", t)
    t = t.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    t = re.sub(r"[ \t ]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()


def _field(item: dict, name: str) -> str:
    for f in item.get("embedded", {}).get("contentFields", []):
        if f.get("name") == name:
            return f.get("contentFieldValue", {}).get("data", "") or ""
    return ""


# Acts and Rules share the same section-harvest shape, differing only in blueprint,
# the id attribute, and the field names carrying the number/title.
_PROFILES = {
    "act":  {"blueprint": "ACT_SECTIONS_BP_ERC", "id_key": "act_id",
             "num_key": "chapter_section_number", "num_field": "sectionNumber",
             "title_field": "sectionShortDescription"},
    "rule": {"blueprint": "RULE_CONTENT_LIST_BP_ERC", "id_key": "rule_id",
             "num_key": "rule_number", "num_field": "ruleNumber",
             "title_field": "ruleShortDescription"},
}


def _body(kind: str, cid: int, year_id: int) -> str:
    p = _PROFILES[kind]
    return json.dumps({"attributes": {
        "search.empty.search": True,
        "search.experiences.blueprint.external.reference.code": p["blueprint"],
        f"search.experiences.{p['id_key']}": cid,
        "search.experiences.year_id": year_id,
        f"search.experiences.{p['num_key']}": "",
    }})


def _api_post(ctx, page, page_no: int, body: str) -> dict | None:
    api = f"{BASE}/o/search/v1.0/search?nestedFields=embedded&page={page_no}&pageSize={PAGE_SIZE}"
    for attempt in range(4):
        try:
            r = ctx.request.post(api, data=body, headers={"Content-Type": "application/json"})
            if r.status == 200:
                return r.json()
        except Exception as e:
            if attempt == 0:
                print(f"    page {page_no} retry: {str(e)[:50]}")
        page.wait_for_timeout(2500)
    return None


def harvest(ctx, page, kind: str, cid: int, year_id: int) -> list[dict]:
    """Return all unit dicts {num,title,chapter,text} for one act/rule-set + year."""
    p = _PROFILES[kind]
    body = _body(kind, cid, year_id)
    j = _api_post(ctx, page, 1, body)
    if not j or not j.get("totalCount"):
        return []
    last = int(j.get("lastPage") or 1)
    items = list(j.get("items") or [])
    for pg in range(2, last + 1):
        jj = _api_post(ctx, page, pg, body)
        if jj:
            items += jj.get("items") or []
    out = []
    for it in items:
        text = clean(_field(it, "documentContent"))
        if len(text) < 15:
            continue
        num = _field(it, p["num_field"]) or re.sub(r"^(Section|Rule)\s*", "", it.get("title", "") or "").strip(" -")
        out.append({
            "num": num,
            "title": _field(it, p["title_field"]) or "",
            "chapter": (_field(it, "chapterTitle") or _field(it, "chapterNumber") or "").strip(),
            "text": text,
        })
    return out


def write_act(slug: str, act_title: str, sections: list[dict], outdir: Path = OUT) -> int:
    outdir.mkdir(parents=True, exist_ok=True)
    lines = [f"{act_title}\n"]
    for s in sections:
        # marker the `act_sections` parser splits on
        head = f"@@SECTION {s['num']} | {s['chapter']} | {s['title']}".rstrip(" |")
        lines.append(f"\n{head}\n{s['text']}\n")
    dest = outdir / f"{slug}.txt"
    dest.write_text("\n".join(lines), encoding="utf-8")
    dest.with_suffix(".txt.meta.json").write_text(json.dumps({
        "title": act_title, "source_host": "incometaxindia.gov.in",
        "source_url": f"{BASE}/finance-acts", "doc_type": "act",
    }, indent=2), encoding="utf-8")
    return len(sections)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        ctx = b.new_context(user_agent=UA, viewport={"width": 1366, "height": 768})
        page = ctx.new_page()
        page.goto(BASE, wait_until="domcontentloaded", timeout=90000)
        page.wait_for_timeout(3000)

        total_secs = total_acts = 0

        # 1) Income-tax Act, 2025 (new act) — latest year
        print("=== Income-tax Act, 2025 ===")
        secs = harvest(ctx, page, "act", IT_ACT_2025_ID, YEAR_IDS["2026"])
        if secs:
            total_secs += write_act("income_tax_act_2025", "Income-tax Act, 2025", secs); total_acts += 1
            print(f"  wrote {len(secs)} sections")

        # 2) Finance Acts — every year that has one
        print("=== Finance Acts (per year) ===")
        for year, yid in YEAR_IDS.items():
            secs = harvest(ctx, page, "act", FINANCE_ACT_ID, yid)
            if not secs:
                continue
            total_secs += write_act(f"finance_act_{year}", f"Finance Act, {year}", secs); total_acts += 1
            print(f"  {year}: {len(secs)} rules/sections")
            time.sleep(0.3)

        # 3) Rules — Income-tax Rules (current, as amended to 2026) + the new 2026 Rules
        print("=== Rules ===")
        RULES = [
            (6388690, "2026", "income_tax_rules", "Income-tax Rules, 1962"),
            (16666527, "2026", "income_tax_rules_2026", "Income-tax Rules, 2026"),
        ]
        for cid, yr, slug, title in RULES:
            secs = harvest(ctx, page, "rule", cid, YEAR_IDS[yr])
            if not secs:
                print(f"  {title}: (none)"); continue
            total_secs += write_act(slug, title, secs, outdir=OUT_RULES); total_acts += 1
            print(f"  {title}: {len(secs)} rules")

        print(f"\nDONE. {total_acts} acts/rule-sets, {total_secs} units -> {OUT} + {OUT_RULES}")
        b.close()


if __name__ == "__main__":
    main()
