# IT-APPEAL TOOL — Project Context & Status

> Single source of truth for this project. Read this first to continue the work.
> **Last updated:** 2026-06-24 (added: case-law API availability/pricing findings)
> **Sources merged:** the requirements recording (`IT - BMTC - APPEAL.m4a`), the officer's three
> handwritten requirement notes, and the officer's working system prompt (`Appeal Order tool.docx`).

## What this project is
An **AI assistant that drafts appellate orders** for the **Commissioner of Income Tax (Appeals) / NFAC**
(National Faceless Appeal Centre) under the Income-tax Act.

The officer **already does this manually today** by pasting a detailed system prompt into **Copilot**
(see `Appeal Order tool.docx`) and working alongside **Taxmann.com / Taxmann.ai** for case law. The ask is
to **productise and automate** that workflow — pull the appeal documents straight from **ITBA**
(itba.incometax.gov.in), run the officer's 6-module logic, fetch **real** supporting case law, and output a
**draft appellate order** ("shell order") for the officer to apply mind to and finalise.

In one line: turn the officer's copy-paste-into-Copilot routine into a **repeatable tool** that his staff
can run, so basic appeal drafting stops depending on his personal expertise.

## The end-to-end workflow (what the tool must do)
1. **Ingest the appealed order:** assessment order and/or penalty order + **demand notice**.
2. **Ingest the appellant's filings:** **Form 35**, **Grounds of Appeal**, **Statement of Facts (SOF)**,
   **Written Submission**, plus any **additional evidence** and **annexures** (e.g. *"Bill is attached as
   Annexure A1"* — must be fetched and linked).
3. **Crystallise** per ground: *issue → grounds → appellant's submission → AO's position/rationale → counter.*
4. **Summarise** the facts from the assessment/penalty order (routine, not over-elaborate) and flag what is
   **deletable**; surface the office's own **prior favourable orders** (2–3) on the same issue.
5. **Fetch case law** (Taxmann / department server) for **reasoning** — used in the *discussion/elaboration*
   to justify the decision; support **distinguishing** ("not applicable because my facts/status are X").
6. **Draft the order issue-wise**, with the officer's finding and decision, and a result
   (**Allowed / Partly Allowed / Dismissed / Set Aside**) with directions to the AO.
7. **Categorise & file** every uploaded document into segregated folders (Form 35, assessment, penalty,
   financial, legal) and produce an acknowledgement.

## The 6 modules (from `Appeal Order tool.docx` — the proven manual prompt = the product spec)
1. **Deficiency Checker** — validate Form 35 vs **Section 249 / Rule 45 / Rule 46A**: completeness,
   verification, appeal fee, tax on returned income, clarity of grounds; **limitation** (date of order →
   date of service → date of filing → compute delay → condonation needed & reasons sufficient?); mandatory
   attachments; detect **Rule 46A** new-evidence situations (was it before the AO? admit / reject / call
   remand report). → *Deficiency Report.*
2. **Scope Validation (Faceless Appeal Scheme 2021)** — identify the section appealed (143(3), 144, 147,
   154, 271B, 270A…), check appealability **u/s 246A**, flag excluded/sensitive categories (fraud, major
   evasion, search, international tax). → *Scope Validation Report.*
3. **Document Category Validation** — classify into Assessment / Penalty / Appeal / Financial / Legal
   records; flag miscategorised or missing. → *Document Compliance Sheet + Missing Document Report.*
4. **Document Understanding** — extract facts/chronology, regroup Grounds of Appeal, summarise appellant
   submissions and the AO's position, build an **Issue Matrix** (issue, facts, evidence, law, AO view,
   appellant view).
5. **Drafting Engine (CIT(A)/NFAC style)** — full draft: Introduction → Grounds → Facts → Submissions →
   Remand Report → Rejoinder → **issue-wise Discussion & Findings** (Facts / Submissions / AO's view /
   Legal position / Analysis / Finding / Decision) → **Result** with directions.
6. **Outputs** — Deficiency Report, Scope Validation Report, Document Compliance Sheet, Case Summary, Issue
   Matrix, **Draft Appellate Order**.

## Data sources / integrations
- **ITBA — itba.incometax.gov.in** (Income-Tax Business Application): the **Appeals worklist**,
  **proceedings**, and **attachments**. This is where Form 35, the orders, submissions and annexures live and
  where the **deficiency** info comes from. **Auto-fetching from ITBA is the #1 hard problem** per the officer.
- **Case-law & reasoning sources** — the high-value input (the *reasoning* used in the order's discussion):
  - **Taxmann.com / Taxmann.ai** — subscription tax-research platform (section-wise, headnoted).
  - **Taxsutra.com** — subscription tax-research/news platform the boss also uses often; same role as Taxmann
    (rulings DB + expert analysis across direct tax, GST, TP/international, company law).
- **Statutory text** (Acts / Rules / sections): the bare law (~3 books, 3,000–4,000 pages) is "basic" and
  available anywhere — bulk-load it locally once; it is **not** the hard part.
- **Department server / website**: alternative source for orders and statutory material.
- **Recent-facts internet search**: only as a top-up where local data is insufficient.

## Data-sourcing strategy — DECISION (revised 2026-06-24): **PDF-first, web secondary, no API dependency**
**Direction set by the officer/owner:** do **not** build on any paid or rate-limited API. The **primary
source of data is downloaded PDF files** (statutory text now; judgments/orders added as PDFs over time),
indexed into a **local layered RAG corpus**. **Web/search is a secondary top-up only** (recent facts, or a
judgment not yet in the corpus) — never a hard dependency. This also satisfies the officer's "run locally on
the office machine" + "data must be original, not invented" asks, and keeps confidential taxpayer documents
on-prem.

**Do not scrape Taxmann/Taxsutra.** Their *editorial* layer (headnotes, tagging, summaries) is copyrighted
and scraping breaches ToS — a non-starter for a govt tool. Raw judgment text is a **public record** (not
copyrightable); collect it as **PDFs** from free official sources. (Indian Kanoon **API** findings retained
below for reference, but it is now **demoted to optional secondary**, not the backbone.)

### Layered RAG corpus — source priority
| Priority | Layer | Source | Status |
|---|---|---|---|
| **PRIMARY** | **Statutory text** | Downloaded **PDFs** of the Act(s) & Rules (see inventory below) | ✅ **5 PDFs in folder now** (text-extractable, no OCR) |
| **PRIMARY** | **Case law / orders** | **PDFs** of ITAT/HC/SC judgments + office **prior favourable orders**, downloaded from free official portals (itat.gov.in, e-SCR/sci.gov.in, eCourts, free indiankanoon.org) and saved locally | ⏳ **none yet — must be added** (this is the high-value gap) |
| **PRIMARY** | **The appeal's own docs** | Form 35, SOF, grounds, submissions, the appealed order, annexures — from **ITBA** as PDFs | ⏳ per-case, at runtime |
| **SECONDARY** | Web / search top-up | Free web search, free indiankanoon.org, govt portals; **Indian Kanoon API only if ever needed** | optional |
| **PREMIUM (manual only)** | Taxmann / Taxsutra | Official **subscription login**, used by a human for reference — *no API, never scraped* | only if dept holds licences |

**Anti-hallucination falls out of this design:** the model is **retrieval-only** — it may cite *only*
documents present in the local indexed corpus, and every citation links back to a stored source PDF (file +
page). The LLM never free-generates a citation. This is how the officer's **"100% proof"** bar is met.

> Bottom line: **local PDF corpus → layered RAG is the backbone**; web/search and any API are **secondary
> top-ups only**; Taxmann/Taxsutra stay a manual human reference. The next data priority is collecting
> **case-law / prior-order PDFs** — the statutory layer alone has no precedent value.

### Local PDF corpus inventory (as of 2026-06-24)
All five are **born-digital, text-extractable** (verified — no OCR needed; minor encoding artifacts to clean:
`§` renders as `�`, `\xa0` non-breaking spaces):
| File | Content | Pages | Size |
|---|---|---|---|
| `Income-tax-Act-1961_2026_…_en.pdf` | Income-tax Act, 1961 (as amended to 2026) | 1,117 | 179 MB |
| `Income-tax-Act-2025_2026_…_en.pdf` | **New Income-tax Act, 2025** | 666 | 107 MB |
| `Income-tax-Rules-1962_…_en.pdf` | Income-tax Rules, 1962 | 628 | 104 MB |
| `Income-tax-Rules-2026_…_en.pdf` | Income-tax Rules, 2026 | 422 | 72 MB |
| `Income-tax-Rules-2026_…_en (1).pdf` | **Exact duplicate** of the above (same MD5) | 422 | 72 MB |
- **Action:** delete the duplicate `… (1).pdf`. Both the 1961/2025 Acts and 1962/2026 Rules are kept on
  purpose (old + new regimes coexist; appeals reference the law as it stood in the relevant year).
- **Gap:** no case-law/judgment or prior-order PDFs yet — needed to make the tool useful for *reasoning*.

## Case-law API availability & pricing — FINDINGS (web-checked 2026-06-24)
Researched whether each platform exposes a programmatic API we can build on. **Net result: only Indian Kanoon
offers a real, self-serve, pay-as-you-go API. Taxmann and Taxsutra do not — they are subscription web/AI
products with no public developer API. Official government portals also have no official bulk/developer API.**
This **confirms the layered-RAG plan**: build on the Indian Kanoon API + free public records; treat
Taxmann/Taxsutra as a manual, human-in-the-loop premium reference (only if the dept already subscribes).

### 1. Indian Kanoon API — ✅ available, cheap, the practical backbone
- **Official API** at `api.indiankanoon.org` with published docs, pricing, signup, and Python/Java clients
  (`ikapi.py`). Pre-paid, **flat pay-per-request** pricing — no fixed subscription.
- **Per-request charges (INR):** Search **₹0.50** · Original/court-copy document **₹0.50** · Document (text)
  **₹0.20** · Document fragment **₹0.05** · Document meta-info **₹0.02**. Charged only for pages actually
  returned; max 1,000 pages per call.
- **Free credits:** **₹500** signup credit to develop/test; **non-commercial** users can get **₹10,000/month
  free** subject to use-case verification by the site admin (a government appeal-drafting tool may qualify —
  worth applying for).
- **Auth:** shared API **token** (`Authorization: Token …`) — simplest; or HMAC public/private-key signing.
- **Coverage:** Supreme Court, all High Courts, district courts, and **tribunals incl. ITAT** (≈3 crore
  docs). Search + full-document + fragment + metadata endpoints; JSON/XML responses.
- **Verdict:** **adopt as the programmatic workhorse.** Costs are negligible at our volumes (a full appeal's
  research is a handful of searches + a dozen document pulls ≈ a few rupees).

### 2. Taxmann — ❌ no developer API (subscription + closed AI product only)
- Taxmann is a **subscription research platform**; its AI layer is **Taxmann.AI** (built with **EY India**) —
  an "Ask Bot / Draft Bot" answering source-backed queries against Taxmann's own DB. It is a **finished
  product, not an API** we can integrate; no public developer/partner API or self-serve API pricing found.
- **Subscription pricing** is plan-based (e.g. Income-Tax web module historically ~₹5,100–9,900/yr for ICAI
  members; current combo/individual plans on `taxmann.com/research-pricing`). Access is **per-seat login**.
- **Verdict:** **no API integration.** Use only via **official institutional login** as a manual reference
  for the curated/headnoted value-add. Do **not** scrape (ToS + copyright on the editorial layer). Confirm
  with the officer whether the dept already holds a licence before relying on it at all.

### 3. Taxsutra — ❌ no developer API (subscription DB only)
- Taxsutra Database (`database.taxsutra.com`) is a **subscription** product (incl. Chaturvedi & Pithisaria's
  Income Tax Law, 85k+ decisions, 70k+ full-text judgments, TP database). **No public API or developer/
  integration offering found**; access is via plan-based login (`taxsutra.com/subscription`).
- **Verdict:** same as Taxmann — **manual reference via official subscription only**, never scraping.

### 4. Government / official sources — ❌ no official open API (use Indian Kanoon as the aggregator)
- **ITAT** (itat.gov.in), **e-SCR / Supreme Court** (sci.gov.in), and **eCourts / High Courts**
  (hcservices.ecourts.gov.in) are **search-driven web portals with no official public/bulk developer API**
  (eCourts is captcha-gated). `data.gov.in` hosts some datasets but not a usable judgment-fetch API.
- What exists for programmatic access is **third-party commercial wrappers** (Vakeel360, eCourtsIndia,
  Surepass — they cover ITAT/HC/SC) and **open-source scrapers** (e.g. `openjustice-in/ecourts`,
  `bharat-courts`). These are options of last resort; vet each for legality/reliability before use.
- **Verdict:** for programmatic case-law retrieval, **Indian Kanoon's API is effectively the official-records
  aggregator** (it already indexes ITAT + HC + SC). Use the government portals directly as the **citation/
  verification source** (link each retrieved judgment back to its official URL where available), and pull
  **ITBA's own case documents** for the specific appeal. Reserve scrapers for gaps the API doesn't cover.

### Action items from these findings
- [ ] **Ask the officer** whether the department already holds **Taxmann and/or Taxsutra institutional
      licences** (and how many seats) — that decides whether the premium manual layer is even available.
- [ ] Provide the officer's **issue-wise matrix (~400–500 items)** so case-law downloads can be *targeted*.
- [x] ~~Sign up for the Indian Kanoon API~~ — **dropped:** per owner decision (2026-06-24) we do **not**
      depend on any API; primary data is local PDFs, web/search is a secondary top-up only.

## Implementation — what is built (2026-06-24)
A working, **fully local / offline** layered-RAG pipeline lives in [`rag/`](rag/) (see [`rag/README.md`](rag/README.md)).
- **Stack (no torch, no paid API, runs on the office machine):** `fastembed` ONNX embeddings
  (`sentence-transformers/all-MiniLM-L6-v2`, 384-dim) + **PyMuPDF** extraction + a dependency-light **NumPy**
  vector store (brute-force cosine — exact, fast to ~1M chunks). Model caches once into `models/` (~80 MB),
  then no network needed. Runs on the machine's Python 3.14 (onnxruntime 1.26 present); Python 3.12 fallback.
  - *Model note:* the higher-quality BGE ONNX models benchmarked **~23× slower** on this CPU (no AVX512-VNNI:
    bge-base 2.4 chunks/s vs MiniLM 56 chunks/s), so MiniLM is the pragmatic v1 embedder. To upgrade quality
    later (e.g. on a GPU box), change `MODEL_NAME`/`EMBED_DIM` in `rag/config.py` and `rag.index --rebuild`.
- **Corpus layers** (`corpus/<layer>/`, drop PDFs in and re-index): `statutes/`, `case_law/`,
  `prior_orders/`, `case_docs/` (per-appeal docs at runtime).
- **Pipeline:** `extract.py` (clean page text; normalises `\xa0`/`�`→`—`, strips footers; flags scanned
  PDFs needing OCR) → `chunk.py` (page-aware, ~1.1k-char chunks with overlap + best-effort section/rule
  label) → `embed.py` → `store.py`. CLIs: **`python -m rag.index`** (incremental by file hash) and
  **`python -m rag.query`** (retrieval-only; returns chunks with `source + page` citation; `--json` for the
  drafting layer; `--layers` filter).
- **Statutory layer indexed (done):** the 4 statutory PDFs (Act 1961, Act 2025, Rules 1962, Rules 2026) —
  2,833 pages → **7,493 chunks** indexed and query-verified (e.g. "penalty for under-reporting" → s.270A;
  "additional evidence" → Rule 46A). Rebuild any time with `python -m rag.index --rebuild`.
- **Case-law layer seeded (done):** `fetch_judgments.py` downloads judgment **PDFs by direct official URL**
  into `corpus/case_law/`. Verified end-to-end with a **real ITAT order** (BBC World Service India Pvt. Ltd,
  ITA No. 1627/Del/2022) downloaded from `itat.gov.in/public/files/upload/…` and indexed (9 chunks,
  retrievable). **e-SCR** `digiscr.sci.gov.in` direct-PDF URLs also work but that host doesn't resolve from
  the dev sandbox — it will on the office network. Put URLs in `corpus/case_law/judgment_urls.txt`. **No
  scraping, no API.** This is the spine of the **anti-hallucination** guarantee: retrieval returns only
  stored PDFs, each with a `source + page` citation.

### Data acquisition — verified sources (researched 2026-06-25)
Where the case-law and prior-order data can actually be obtained. **All free & legal; no scraping by us, no
paid API.**

**Case-law layer — ranked:**
1. **Indian High Court Judgments — AWS Open Data (BEST bulk).** Public S3 bucket `indian-high-court-judgments`
   (`https://indian-high-court-judgments.s3.ap-south-1.amazonaws.com/`, **no AWS account**, `--no-sign-request`).
   **17.8M HC judgment PDFs + Parquet metadata, CC-BY-4.0**, sourced from official **eCourts**, updated daily.
   Metadata columns include `case_type`, `title`, `petitioner`/`respondent`, `pdf_link`, `decision_date`,
   `disposal_nature`, `judge` → **income-tax cases are filterable**. *Verified 2026-06-25:* listed the bucket,
   read a metadata Parquet, found **2,215 income-tax matches in Bombay HC 2023** (of 127,700), and downloaded
   a tax judgment PDF. PDF key pattern: `data/pdf/year=YYYY/court=<c>/bench=<b>/<basename(pdf_link)>`.
   Sibling repo **`indian-supreme-court-judgments`** for SC. → build `rag/fetch_hc_judgments.py` to filter +
   pull the income-tax subset into `corpus/case_law/`.
2. **ITAT — `itat.gov.in` (the core layer for CIT(A) appeals).** ITAT is the next appellate level; its orders
   are the most-cited precedents. Direct PDF URLs verified (`/public/files/upload/…-TO.pdf`); search at
   `/judicial/tribunalorders`. **The AWS corpus above does NOT include ITAT (HC/SC only)** — so ITAT is the
   main gap: collect by **targeted download per issue/appeal-no** (best done on the office network).
3. **Official portals (verification & gap-fill):** `judgments.ecourts.gov.in` (HC+SC free full-text search +
   PDF download), **e-SCR `digiscr.sci.gov.in`** (official Supreme Court Reports). Use these to confirm
   citations and grab specific judgments by issue.
4. **Research corpora (supplementary, public-record judgment text from IndianKanoon):**
   `opennyaiorg/InJudgements_dataset` (HF, Apache-2.0, 15k judgments incl. a small tax/ITAT subset),
   **NyayaAnumana** (~702k cases incl. tribunals), `law-ai/InLegalBERT` corpus (5.4M SC+HC). Good for breadth.

**Prior-orders layer — NOT publicly available.** CIT(A)/NFAC appellate orders are faceless and communicated
only to the parties; they are **not published** on any portal. This layer can come **only from the
department / ITBA** — the officer's own prior orders (he referenced "prior favourable orders" and "~500–600
orders"). → depends on the **ITBA-access** open question; ask the officer to export a set of his past orders
as PDFs into `corpus/prior_orders/`.

**Recommended acquisition order:** (a) build `fetch_hc_judgments.py` and pull the income-tax HC+SC subset from
AWS Open Data (bulk, instant breadth); (b) get the officer's **issue matrix** to target ITAT downloads;
(c) get the officer's **prior orders** from ITBA. The pipeline already ingests any PDF dropped into
`corpus/case_law/` or `corpus/prior_orders/`.

## TRIAL BUILD — status (target: Tue 2026-06-30 / Wed 2026-07-01)
A working end-to-end **trial MVP** of the officer's 6-module workflow is built in [`appeal_tool/`](appeal_tool/)
(see [`appeal_tool/README.md`](appeal_tool/README.md)). Decisions taken for the trial: **AI backend = decide
later** (built backend-agnostic — `mock`/Claude/local via one env var); **trial data = synthetic sample
appeal**; **interface = minimal web app**; **issue scope = common recurring issues** (s.68/69, s.37/14A
disallowance, penalty 270A/271(1)(c)/271B, condonation u/s 249, Rule 46A additional evidence).

**What works now (verified end-to-end in mock mode):**
- **Upload appeal PDFs → 6 modules → Draft Appellate Order**, via the web app (`python -m appeal_tool.app`)
  or headless (`python -m appeal_tool.pipeline <folder>`). Outputs written to `outputs/<appeal>/`.
- **Module 3** (doc classification/compliance) — deterministic; correctly tags Form 35 / orders / grounds /
  SOF / submissions and reports missing docs.
- **Modules 1,2** (Deficiency, Scope) — LLM + **statutory retrieval** (the 7,493-chunk statute index).
- **Module 4** — Issue Matrix (LLM JSON; heuristic fallback detects the common issues even with no model).
- **Modules 5/6** — issue-wise Discussion & Findings + Result, drafted against **case-law retrieval**
  (289 real income-tax judgments indexed: 288 Bombay HC 2023–24 + 1 ITAT; corpus grows by dropping in PDFs).
- **Anti-hallucination guardrail** — every `[source: file p.N]` the model emits is audited against the
  retrieved set; ungrounded citations are flagged (`06_citation_audit.json`).
- **Synthetic sample appeal** at `corpus/case_docs/sample_appeal_ABC_AY2021-22/` (s.68 + s.37 + 8-day
  condonation + Rule 46A) to build/demo against; swap in the officer's anonymised real appeals when shared.

**Remaining for the trial (this week):**
- [ ] **Wire the AI backend** (one env var) once the officer/team confirm Claude vs local — the only step
      between mock and real drafts. Then quality-tune the prompts on real output.
- [ ] Get **1–3 anonymised real appeals** from the officer to validate quality (the synthetic set proves plumbing).
- [ ] Optional: widen the case-law corpus (more courts/years via `fetch_hc_judgments`) and polish the draft
      formatting to match the office's house style.
- [ ] Officer dry-run + fixes.

**Explicitly deferred past the trial:** ITBA auto-fetch (use manual upload), the full all-years corpus + ANN
store, fully-offline on-prem LLM, all order types. Prior-orders layer still needs the department's own orders.

### Web app (M1) — BUILT 2026-06-25
Per owner decision, building the **long-term product** (not a throwaway). Full plan in
[`ARCHITECTURE.md`](ARCHITECTURE.md); run instructions in [`README.md`](README.md). **M1 vertical slice works
end-to-end on the dev box:**
- **Backend** [`server/`](server/): FastAPI + SQLAlchemy (SQLite dev / Postgres-ready) + JWT auth with roles
  (officer/senior/admin) + license expiry + audit log. Wraps the `rag`+`appeal_tool` engine; runs the
  6-module pipeline as a background job; persists cases/documents/runs/outputs. Verified e2e via API
  (login → case → upload → run → outputs → admin corpus stats).
- **Frontend** [`web/`](web/): Next.js (React/TS) — login, case dashboard, **case workspace** (upload + live
  classification + missing-doc flags, run with status polling, all module outputs, **editable draft order**,
  **citation audit**, source-PDF view links), and **admin** (users/licenses, corpus stats + reindex, audit).
  Builds cleanly; serves against the API.
- **Deploy scaffolding** [`infra/`](infra/): docker-compose (pgvector Postgres, Redis, MinIO, api, web) +
  Dockerfiles + `.env.example`.
- **Frontend choice:** Next.js (React/TS), optimised for long-term over the 5-day trial.
- **Next (M2+):** Postgres+**pgvector** store backend; **Celery** worker; per-issue regenerate + versions;
  full admin (prompt mgmt, usage/cost, feedback → fine-tuning export); SSO; then on-prem own model + ITBA.

### Re-architecture to a real product (2026-06-25)
Owner direction: build a proper, scalable, multi-user product (not a 2-page app). Full specs in
[`REQUIREMENTS.md`](REQUIREMENTS.md) + [`ARCHITECTURE.md`](ARCHITECTURE.md). Decisions: **multi-office
tenancy** (scoped admins), provisioning by **email invite + temp-password fallback**, **public landing +
request-access**, **separate admin portal**.

**Epic 1 (Foundation) — BACKEND DONE & TESTED:** the thin MVP backend was rebuilt into a modular FastAPI app
under `/api/v1`:
- `server/core/` (config, db, security = bcrypt + **JWT access + rotating refresh tokens** + opaque
  invite/reset tokens, RBAC roles, deps/guards, error envelope, audit).
- Multi-tenant data model: `Organisation, User(status/role/license/org), AccessRequest, Invitation,
  PasswordReset, RefreshToken, Case(+org), Document, Run, Output(versioned), UsageRecord, Notification,
  AuditLog`.
- Modules: `auth` (login/refresh/logout/accept-invite/forgot/reset/change-password), `access_requests`
  (public submit → admin **approve/reject → provision** user + invite or temp password + email),
  `users` & `orgs` (RBAC + org-scoped), `cases` (org-scoped, owner/senior/super visibility) + DOCX export,
  `corpus` (super-admin), `admin_misc` (stats + audit). Seeds default org + super-admin on first boot.
- **Verified via API:** request→approve→provision(temp pw)→login→me; officer **403** on admin; officer
  creates case; **refresh rotation** works and a reused rotated token is **rejected (401)**.
- Roles: `super_admin > org_admin > senior > officer (+ auditor)`. Old thin `server/routers/` + the simple
  `appeal_tool/app.py` web app are **superseded**.
**Epic 1 (Foundation) — FRONTEND DONE & TESTED:** `web/` rebuilt into Next.js App-Router route groups,
wired to `/api/v1` with an access+refresh client (auto-refresh on 401):
- `(marketing)` public **landing** + **request-access** form.
- `(auth)` **login** · separate **admin-login** · **set-password** (invite accept) · **reset** · **forgot**.
- `(app)` officer shell: **dashboard** (cases) + **case workspace** (upload + live classification, run with
  status polling, all module outputs, editable draft, citation audit, source-PDF links, DOCX download).
- `(admin)` console: **dashboard/stats**, **approvals queue** (approve with role/org/licence → shows temp
  password / invite link), **users & licences**, **organisations**, **corpus**, **audit**. Client-side role
  guards in the layouts; API enforces server-side.
- **Verified:** clean `next build` (15 routes), all routes serve 200, admin console reads pending requests +
  stats from the live API. (Run backend `uvicorn server.app:app`, frontend `npm run dev`.)

**Epic 1 is complete (backend + frontend).**

### Epic 2 progress — E2a + E2b DONE & TESTED (2026-06-25)
- **Per-issue regenerate + draft versions (E2a):** pipeline refactored into reusable `draft_issue()` +
  `assemble()`; each issue's finding is stored as its own versioned `Output` (kind=`finding`, seq, label).
  New endpoints: `POST /cases/{id}/issues/{seq}/regenerate` (re-draft one issue → new finding version),
  `POST /cases/{id}/reassemble` (rebuild draft from latest findings → new draft version),
  `GET /cases/{id}/draft-versions`. Edits append a new version (history preserved). Workspace UI shows
  per-issue findings with **Regenerate**, a **Reassemble** button, and a **draft version selector**.
  *Verified:* run → 4 findings v1 → regenerate issue 0 → finding v2 → reassemble → draft v2 → versions [v2,v1].
- **WebSocket live progress (E2b):** pipeline emits stage labels via a `progress` callback → `Run.progress`;
  `GET ws /api/v1/ws/runs/{rid}?token=` streams `{status, progress}` until done (token-authed; rejects bad
  tokens). Workspace subscribes (polling fallback). *Verified:* live stages "Reading documents → Module 1 →
  2 → 4 → Module 5 issue 1/4..4/4 → Module 6 → done".
### Epic 2c — Postgres + pgvector + Celery/Redis DONE & TESTED (2026-06-25)
Production data + queue + scalable vector store, all behind config flags (`.env`):
- **Postgres** app DB (`APPEAL_DATABASE_URL`) — SQLAlchemy models created + seeded on Postgres (15 tables).
  Dev containers run on **alt ports** to avoid the existing `taxmedha` stack + WSL Redis already on the box:
  `appeal-pg` :5433 (image `pgvector/pgvector:pg16`), `appeal-redis` :6380 (`redis:7-alpine`).
- **Celery + Redis** worker (`APPEAL_JOBS_BACKEND=celery`, `server/workers/celery_app.py`): `/run` enqueues;
  worker processes out-of-process; **live progress streams across processes via `Run.progress` in Postgres**
  → the WebSocket. Run worker: `celery -A server.workers.celery_app:celery worker --pool=solo`.
- **pgvector store backend** (`APPEAL_VECTOR_BACKEND=pgvector`, `rag/store_pg.py` + `rag/store.py:load_store()`):
  34,430 embeddings bulk-loaded via `python -m rag.migrate_pg` (ivfflat cosine index, probes=10). Retrieval
  switches backend with one env var; NumPy store remains the default/fallback.
- **Verified full stack:** case run **queued → Celery worker → live per-module progress (M1→M6) → done**,
  pgvector retrieval, regenerate (v2, 0 ungrounded), reassemble (draft v2), versions [v2,v1].

**Epic 2 complete.**

### Epic 3 progress — admin depth (E3a/b/c DONE & TESTED 2026-06-25)
- **AI model + prompt management (E3b):** admin config in DB Settings (provider, model, temperature,
  retrieval top-k, **editable officer system prompt**), `GET/PUT /api/v1/admin/config` (super-admin).
  **Applied at run time** — `jobs._apply_admin_config()` reads Settings and sets env / passes top_k before the
  pipeline; `prompts.system_for()` honours an `APPEAL_SYSTEM_PROMPT` override (anti-hallucination rules always
  appended, not editable). Admin UI **/admin/settings**. *Verified:* set model=gemini-2.5-flash → run.model
  reflected it.
- **Usage/cost (E3c):** `appeal_tool/llm.py` tracks per-run token usage; `jobs` writes a `UsageRecord` per run;
  `GET /api/v1/admin/usage` aggregates (org-scoped). Admin UI **/admin/usage**. *Verified:* a run recorded
  in=30,487 / out=15,973 tokens.
- **Corpus upload (E3a):** wired `/admin/corpus/upload` into **/admin/corpus** (pick layer → upload → reindex).
- **Case-law acquisition console (E3d):** `rag.fetch_hc_judgments.run_acquisition()` + Celery task
  `acquire_case_law` (download from AWS Open Data → `rag.index` → pgvector reload) with live status in a
  `Setting`. API `POST /admin/corpus/acquire` + `GET /admin/corpus/acquire-status`; UI on **/admin/corpus**
  (court/years/limit + status). *Verified:* scan→download→index→pgvector pipeline ran to `done`. (Note: ~4% of
  HC files 404 from a bench-path quirk in `download_one` — a refinement; bulk run earlier got 288/300.)
- **Feedback → fine-tuning export (E3e):** `Feedback` model + `POST /api/v1/feedback` (rating/comment;
  workspace widget); `GET /api/v1/admin/feedback/export.jsonl` builds an **SFT dataset from accepted/edited
  draft orders** (system/user/assistant messages + rating), org-scoped — for *style* fine-tuning only (facts
  stay retrieval-grounded). Admin button on **/admin/usage**. *Verified:* exported 3 records.

**Epic 3 complete (admin depth).**

### Epic 4 — hardening & scale (DONE & TESTED 2026-06-25)
- **Observability:** `server/core/observability.py` — request-ID + timing middleware, structured JSON access
  logs, **Prometheus `/api/v1/metrics`** (http_requests_total + latency histogram), optional **Sentry**
  (`SENTRY_DSN`). **Readiness `/api/v1/ready`** checks DB + Redis (503 if down). *Verified.*
- **Security:** security headers (nosniff / DENY / referrer-policy) on every response; **Redis rate-limiting**
  + **login lockout** (`server/core/ratelimit.py`, fail-open if Redis down). *Verified: 429 after repeated
  bad logins.*
- **MFA (TOTP):** `pyotp` — `/auth/mfa/setup|enable|disable|status`, login gated when enabled; frontend
  **/profile** (enrol/enable/disable + change password) and an OTP field on /login. *Verified full flow.*
- **Schema drift:** `server/core/migrate.py` idempotent `ADD COLUMN IF NOT EXISTS` (Postgres) at startup —
  keeps the dev DB current without dropping data (prod = Alembic).
- **Scaffolds (deploy-time, not runtime-tested here):** **CI** `.github/workflows/ci.yml` (backend import/lint/
  test + frontend build); **k8s** `infra/k8s/app.yaml` (api/worker/web Deployments+Services, readiness/liveness
  probes) + `infra/k8s/README.md`; **SSO/OIDC stub** `server/modules/sso.py` (`/auth/sso/*`, returns 501 until
  `OIDC_*` configured — full IdP wiring is a deployment task).

**Epic 4 complete.**

### Epic 6 — Research Assistant (DONE & TESTED 2026-06-25)
Taxmann.AI-style **"Ask"** chatbot + Taxsutra-style **Rulings** search, over the **admin-curated corpus
only** (statutes / case law / prior orders). **Officers add no knowledge** — they only ask; corpus is curated
by admins (per owner direction). Plan: [`RESEARCH_ASSISTANT_PLAN.md`](RESEARCH_ASSISTANT_PLAN.md).
- **Backend** `server/modules/research.py`: `POST /research/ask` (retrieve corpus → cited answer,
  retrieval-only guardrail, token usage recorded, **daily quota**), `GET /research/conversations[/{id}]`,
  `GET /research/rulings` (semantic case-law search enriched with HC-manifest title/court/date + court filter),
  `GET /research/source?file=&token=&page=` (serves corpus PDF at page; token via query so `<a>` links work).
  Models: `Conversation`, `Message` (with `sources_json`).
- **Frontend** (officer app): **/research** (chat + history rail + scope/style + Sources linking to source
  PDF at page + "Insert into a case draft" bridge) and **/rulings** (search + court filter + PDF + "Ask").
  Nav links added; officer-only (admins are separated out of the app).
- *Verified:* ask → 529-char structured answer, 8 sources, **0 ungrounded**, quota 0→1/50, conversation
  saved; rulings → 19 real case-law hits.
- *Note:* "Insert into draft" currently prompts for the case id (functional; a case-picker dropdown is a
  polish). Real token-streaming of answers is a future polish (answers are returned whole now).

Remaining: **E5 domain** — on-prem own model + fine-tuning loop, **ITBA integration** (auto-fetch appeal
docs), all order types; plus full SSO IdP wiring and Alembic migrations for production.

> **Dev-box port note:** the running `taxmedha` stack maps host **:8000** and uses **:5432/:6379**; WSL also
> has Redis. This project uses **API :8099**, **Postgres :5433**, **Redis :6380**. Set `web/.env.local`
> `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8099` to match.

Then E4 hardening/scale (SSO/MFA, observability, CI/CD, k8s), E5 domain (on-prem own model, ITBA).

### M2 progress — Gemini wired + DOCX export (2026-06-25)
- **LLM = Gemini live.** `APPEAL_LLM_PROVIDER=gemini`, default model **gemini-2.5-flash** (key in gitignored
  `.env`, loaded via python-dotenv). Verified end-to-end through the API: real 6-module drafts on the sample
  appeal. Gotchas handled: Gemini 2.5 are *thinking* models — hidden reasoning consumed `max_tokens` and
  truncated output, so we set **`reasoning_effort`** (env `APPEAL_GEMINI_REASONING`, default `none`) and give
  structured calls a larger budget; added **retry/backoff** for transient 503 "high demand" + **per-issue
  resilience** so one failed call can't lose the whole order.
- **Anti-hallucination guardrail validated on real output:** the model cites retrieved case law + the appeal's
  own documents; the audit splits multi-citations and counts appeal docs as valid → on the sample, **0
  hallucinated case citations** (the only flag was a descriptive phrase mis-placed in a `[source:]` tag).
- **DOCX export** ([`appeal_tool/export.py`](appeal_tool/export.py)) — `GET /api/cases/{id}/export.docx`
  renders the (edited) draft order to an editable Word file; "Download .docx" button in the workspace.
  Verified HTTP 200, valid 42 KB doc.
- ⚠️ **Key hygiene:** the Gemini key was shared in chat — treat as exposed; **rotate after the trial**.

## Deployment roadmap & packaging (owner direction, 2026-06-25)
Phased plan agreed with the owner:
1. **Dev box (now):** build + demo on the dev laptop (i7-11800H, 15.7 GB RAM, 4 GB VRAM — too small for a good
   local LLM; use a cloud API for the trial). ✅ pipeline built.
2. **Server + cloud API:** host the web app on a server; **LLM = Gemini API** (adapter support added —
   `APPEAL_LLM_PROVIDER=gemini`, `gemini-2.5-pro`/`flash`). Claude also supported.
3. **Rented GPU server + own model:** host an open model (**Qwen2.5-32B-Instruct on a 24 GB GPU** is the
   credible on-prem sweet spot; 70B on 48 GB for near-Claude) via vLLM/Ollama, and/or **fine-tune**.
   - **Steer on fine-tuning:** for this task **RAG > fine-tuning**. Facts/citations must stay
     retrieval-based (fine-tuning to "know law" *increases* hallucination). Fine-tune only for **house
     style/tone**, using the officer's **own past orders** — i.e. the `prior_orders` layer is *also* the
     fine-tuning dataset. So collecting prior orders serves both RAG and future fine-tuning.

**Packaging — can it be a .exe? Yes.** The app is pure Python (PyInstaller/Nuitka-packageable). Options:
- **A. Hosted web app + per-officer logins (recommended):** model + RAG on the server; officers open a URL;
  "trial license" = a login. Easiest to license/update/audit; best for confidentiality. *We already have the
  web app.*
- **B. Thin desktop .exe client:** small exe (UI + local RAG/embeddings) calling the server/Gemini for the
  LLM. For officers who want a desktop app; needs build/sign/auto-update.
- **C. Fat offline .exe:** bundles a local LLM (llama.cpp + GGUF) for no-internet machines — GB-sized, limited
  by each PC's hardware. Only if truly required.
- Confidentiality note: live taxpayer data + cloud LLM (Gemini/Claude) needs a data-handling sign-off; the
  rented-GPU own-model phase removes that concern for full rollout.

## Key points & constraints from the officer
- **Faithful, non-hallucinated output is mandatory.** Today the AI sometimes hallucinates judgments; the
  officer wants it **"100% proof"** — every cited case law must be a **real** judgment with original source data.
- **Mind application stays human.** The tool produces a *draft ("shell") order*; the officer applies mind on
  each issue before finalising. It is a drafting aid, not the decider.
- **Staff-enablement is the motivation:** automate the "basic things" (Grounds of Appeal, SOF, submissions)
  so junior staff aren't dependent on the officer's expertise.
- **Possible on-premise/offline direction:** the officer floated building a **self-contained module** that
  loads the data and **runs locally on the office machine**, with internet search only for recent facts.
  (Delivery model not locked — confirm.)
- The officer is the **domain (law) expert, not an engineer** — he was on the *law* side of faceless
  assessment, a separate team built that system. He'll explain the **procedure**; the team supplies the tech.

## Open questions (to confirm with the officer)
1. **ITBA access** — how does the tool authenticate and fetch from itba.incometax.gov.in? API, official
   data dump, or screen-driven automation? (This is the critical blocker.)
2. **Case-law access** — strategy now confirmed by the 2026-06-24 findings: backbone = **Indian Kanoon API
   (the only real API) + free official records + ITBA docs**; Taxmann/Taxsutra have **no developer API** so
   they can only be a **manual** premium layer. *Remaining ask for the officer:* does the department already
   hold institutional **Taxmann / Taxsutra** licences (and how many seats)? The officer also maintains an
   **issue-wise matrix of ~400–500 items** — how is that fed in?
3. **Delivery model** — cloud assistant (Copilot-style) vs the **offline on-prem module** he floated? Which?
4. **Scope** — all order types (143(3)/144/147/154/271B/270A…) from day one, or a narrower v1?
5. **Hallucination guardrail** — confirmed approach: **retrieval-only** citation against the indexed corpus,
   every citation linked to a stored source document (no free-generated cites).
6. **File handoff** during development — WhatsApp vs Drive (he asked); and data-handling/confidentiality
   rules for live taxpayer documents.
7. **"Does Claude work?"** — the team asked about Claude; confirm the intended AI backend.

## Files in this folder
| File | What it is |
|---|---|
| `Appeal Order tool.docx` | **The officer's working system prompt** — CIT(A)/NFAC appeal-drafting assistant, the 6-module spec |
| `IT - BMTC - APPEAL.m4a` | Source audio of the requirements discussion (28:50) |
| `transcript.txt` / `.srt` | Raw local transcript (timestamped / subtitle) — Hindi+English, ASR errors expected |
| `Appeal_Discussion_Transcript.md` | **Cleaned, translated (English) transcript** of the discussion |
| `WhatsApp Image … .jpeg` (×3) | Officer's handwritten requirement notes |
| `transcribe.py` | Local Whisper transcription script (reads the local .m4a) |
| `PROJECT_CONTEXT.md` | This file — single source of truth |

## What the handwritten notes added (cross-check)
- *"From Form 35 → AI gives paragraph, grounds of appeal, submissions"*; *"Tool → analyse grounds of appeal
  vs the submissions → our order."*
- *"Appeal → if AO's order is correct, accepted; if not, dismissed"*; *"give in favour of department";
  "notice was served."*
- *"Write decision / elaborate decision"* citing *"§500–600 orders, evidence, Act, Taxmann.ai."*
- *"Application → upload → order / demand notice"*; appellant provides *grounds, statement of facts, written
  submission.*
- *"Case law & annexure — will get reasonings, what happened earlier, fetch from older orders."*
- *"Events / case history — dates: on this date this happened, this was released."*
- Sources: *itba.incometax.gov.in (appeals worklist, proceedings, attachments)*; *Taxmann.ai*;
  *"auto-download → automate this procedure, like Claude co-works."*

## Possible next steps (not yet done)
- A **formal PRD** + phase plan (deferred — current deliverable is context only).
- An **ITBA integration spike** to settle how documents are fetched (the critical unknown).
- A **case-law retrieval design** that guarantees real, cited judgments (no hallucination).
- A **prototype** wiring the 6 modules to sample documents.
