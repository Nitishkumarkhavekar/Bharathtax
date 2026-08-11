# BharatTax — Gap-Closure Execution Plan

Baseline (2026-07-03): **113,639 docs / 519,158 chunks**, live on prod. Phases 0–5 done.
This plan closes the remaining gaps to full Taxmann-parity, tiered by **value ÷ effort**.

**The proven cycle** (reused for every item): `acquire → ingest → GPU-embed (durable rule) → prod-sync`.
Tooling we already have: ITD `ACT_SECTIONS`/`RULE_CONTENT` API (`crawl_acts.py`), ITD Liferay crawler
(`crawl_itd.py`), AWS case-law pipeline (`acquire_caselaw.py`/`acquire_sc.py` + `case_law.py`),
`freshness.py`, `prod_sync.py`. Status: `[ ]` todo · `[~]` in progress · `[x]` done.

Timeline notes are **working time** (mostly unattended runs); a "day" ≈ a focused session.

---

## TIER 1 — Quick primary-law wins (existing tooling)   ≈ 2–3 days total
High value, low effort — mostly the ITD APIs we already cracked.

- [ ] **1. Allied direct-tax acts** *(≈ half-day)* — Wealth-Tax, Benami, Securities Transaction Tax,
  Commodities Transaction Tax, Equalisation Levy, Expenditure-Tax (+ confirm Black Money / Vivad /
  Gift-tax are in the live corpus). Source: **ITD `ACT_SECTIONS` API** (catalog `/o/c/actassetcategories/`,
  cat ids already found). *Catch:* single-version acts need their own `year_id`, not 2026 — find via the
  act's amendments list. Method: extend `crawl_acts.py` targets → harvest → ingest (`act_sections`) → embed.

- [ ] **2. DTAAs / Tax Treaties** *(≈ 1 day)* — India's ~90+ bilateral treaties + protocols + TIEAs.
  **Biggest primary-law gap** (international tax). Source: incometax.gov.in "International Taxation →
  DTAAs" (scout: likely a listing of PDFs or a structured section). Method: scout structure → crawler →
  ingest (PDF or a `treaty` parser profile) → embed. New domain-tag optional (`income_tax`/`intl_tax`).

- [ ] **3. Finance Act Memorandum + Notes on Clauses** *(≈ 1 day)* — the govt's OWN clause-by-clause
  explanation of each Finance Act. **Best cheap way to close the commentary gap** (source material, no
  copyright). Source: incometax.gov.in "Budgets & Bills" / indiabudget.gov.in (per-year PDFs). Method:
  crawl per-year PDFs → ingest (cbdt-style parser) → embed. Do all years (1990s→2026).

- [ ] **4. CBDT Instructions / Press Releases / FAQs** *(≈ half-day each)* — officers rely on Instructions
  & OMs. Source: **ITD Liferay** (find the blueprint/section like circulars) or e-filing portal. Method:
  add sections to `crawl_itd.py` → download → ingest (`cbdt` parser) → embed.

- [ ] **5. Prescribed Forms (ITR + others)** *(≈ few hrs)* — metadata/context only (which form for what).
  Lower value. Source: e-filing portal. Method: manifest of form name→purpose; ingest as short docs.

---

## TIER 2 — Case-law completeness   ≈ 3–5 days
- [ ] **6. AAR / AAAR rulings** *(≈ 1 day)* — Advance Rulings (commonly cited, esp. international/PE).
  Source: incometax.gov.in AAR section / itat-style portal — **scout access first** (may be captcha-gated
  like ITAT). Method: same case-law pipeline (`case_law.py`, content-hash dedup) once PDFs in a folder.

- [ ] **7. ITAT (bounded)** *(≈ 1–2 days for a slice; RTI weeks in parallel)* — DEFERRED for full crawl
  (captcha × per-bench/date = impractical/impolite). Do a **bounded slice** (recent ~1 yr + major benches
  Mumbai/Delhi) via human-in-the-loop captcha, OR file an **RTI/bulk-data request** to ITAT/NIC for the
  full set. See `memory/itat-deferred.md`. Ingest via existing `case_law.py`.

- [ ] **8. Title-filter leakage fix** *(≈ half-day)* — our HC/SC harvest filtered on "Income Tax" in the
  *title*; catch tax cases titled only by assessee name. Method: widen the filter (petitioner/respondent
  fields + a keyword pass on `description`), re-harvest deltas, ingest new (idempotent dedup).

---

## TIER 3 — Capability upgrades (usability parity vs Taxmann)   ≈ 1–2 weeks
Not new sources — features on the corpus we have. Highest *usability* ROI.

- [ ] **9. Section-citation metadata** *(≈ 1–2 days)* — extract which sections each judgment cites
  (regex on judgment text → `s/sec/u/s NN`), store structured → enables "every case on Section 68".
  Method: extraction pass + backfill ~100k judgments' chunks/docs (a `sections_cited` column/extra field).

- [ ] **10. Case digests / headnotes (LLM-generated)** *(≈ 3–5 days, GPU)* — a 2-line "what it held"
  per judgment (Taxmann's big time-saver). Method: batch LLM over the ~100k judgments (on the GPU box)
  → store as a `digest` field, embed it too (short, high-signal for retrieval). Big compute; batch on GPU.

- [ ] **11. Cross-references** *(≈ 1 week)* — auto-link section ↔ rule ↔ circular ↔ case from extracted
  citations. Method: build a citation graph from #9 + circular/section references; expose in retrieval.

---

## TIER 4 — Advanced   ≈ 1 week+ each
- [ ] **12. Point-in-time versioning** *("the Act as it stood on 1-Apr-2015")* — we have the amendment
  trail (Finance Acts) but don't auto-reconstruct historical versions. Hard (apply amendments in order,
  effective-date logic). The `versioning.py` supersede logic is a start. Defer unless a user needs it.

---

## TIER 5 — Multi-domain expansion (strategic — new markets)   ≈ weeks each
The schema is domain-ready (`domain` axis; "uncomment + drop files"). Each is a fresh corpus like income-tax was.

- [ ] **13. GST** *(≈ 1–2 weeks)* — CGST/SGST/IGST Acts + Rules + notifications + circulars + GST case law
  (HC + AAR + tribunal). Source: cbic-gst.gov.in + GST portal + AWS HC (GST-titled). Biggest adjacent market.
- [ ] **14. Customs / FEMA / Company Law** *(≈ 1–2 weeks each)* — Customs Act+tariff (CBIC), FEMA (RBI),
  Companies Act (MCA). Do only if the product goes multi-domain.

---

## Recommended sequence & rough timeline

| Wave | Items | Effort | Outcome |
|---|---|---|---|
| **Wave 1** | #1 allied acts, #2 DTAAs, #3 Finance Act Memorandum | ~2–3 days | **Primary statutory law COMPLETE** + commentary-gap dented |
| **Wave 2** | #4 Instructions/Press/FAQs, #6 AAR, #8 filter fix | ~2–3 days | **Executive + advance rulings complete** |
| **Wave 3** | #9 section-cite metadata, #10 digests | ~1 week | **Usability parity** (case search + headnotes) |
| **Wave 4** | #7 ITAT (bounded / RTI), #11 cross-refs | ~1 week + RTI | Case-law depth + linking |
| **Wave 5** | #13 GST (then #14) | ~2 weeks each | **Multi-domain** (new markets) |
| Later | #12 point-in-time versioning, #5 forms | as needed | Advanced/nice-to-have |

**Fastest path to "no primary-law gaps":** Wave 1 + Wave 2 (~1 week) → the corpus has *every* primary
income-tax source. **Biggest competitive leap:** Wave 3 (digests + section search) — the features users
feel daily. **Biggest market expansion:** Wave 5 (GST).
