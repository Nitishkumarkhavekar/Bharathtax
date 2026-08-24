# BharatTax — Income-Tax Product Roadmap: Personalization & Daily-Workspace Layer

**Status:** Proposal for build · **Owner:** Product · **Last updated:** 2026-08-24
**Source:** Adapted from the GST planning doc (Tab 1) into the income-tax context. Hero feature confirmed: **Limitation Calendar + Reminders.**

---

## 1. Thesis — from "Q&A chatbot" to "daily workspace"

Today BharatTax (BT) answers tax questions with grounded citations. So does every generic AI tool. The durable differentiator is a **personalization + productivity layer** that makes an officer or CA *live inside* BT every working day instead of visiting only when they have a doubt.

In income tax, the thing that runs people's lives is **statutory limitation dates** — time-barring assessments, 30-day appeal windows, 148 reopening timelines, the DRP clock, penalty limitation. A calendar/reminder engine built around *statutory* deadlines (not just personal to-dos) is something no chatbot has. **That is the wedge — and the hero of this roadmap.**

Everything below is income-tax specific. GST is a parallel track (same engine, different corpus) and is out of scope for this doc except where shared.

---

## 2. What we're building (feature catalog + priority)

| # | Feature | Priority | One-line |
|---|---------|----------|----------|
| 1 | **Limitation Calendar + Reminders** | **P0 (hero)** | Auto-computed statutory deadlines + nudges, per matter |
| 2 | **My Matters / Docket** | P0 | Track cases by PAN/appeal-no; anchor for notes, dates, drafts |
| 3 | **Role-based dashboard** | P0 | Dashboard reshapes per wing/role |
| 4 | **Sticky Notes** | P1 | Notes pinned to a case / section / answer / document |
| 5 | **Personal Templates** | P1 | Reusable order/notice/appeal templates |
| 6 | **Statutory Calculator & Interest Engine** | P1 | 234A/B/C, 220(2), 115BBE, surcharge/cess — in a side panel |
| 7 | **AIS / 26AS / TIS Reconciliation** | P1 | Income-tax analog of the GSTR reconciliation engine |
| 8 | **Daily/Weekly Digest + Watchlists** | P2 | Personalized feed of new circulars/notifications/rulings |
| 9 | **Collaboration (teams)** | P2 | Share matters/notes/drafts within a range/circle/firm |
| 10 | **Word / Excel plug-in** | P2 | Query BT + insert cited text without leaving the doc |

Phasing in §14.

---

## 3. Roles & wings (drives the role-based dashboard)

Onboarding asks **"How do you use BharatTax?"** and the dashboard, default corpus, templates, and calendar categories change accordingly.

| Role / Wing | Primary daily surface |
|---|---|
| **Assessing Officer** (ITO / ACIT / DCIT) | Scrutiny docket, **time-barring calendar**, notice/limitation reminders, AIS/26AS reconciliation, draft assessment orders |
| **I&CI** (Intelligence & Criminal Investigation) | Entity/sector watchlists, SFT/AIS analysis notes, analytics prompts |
| **Investigation** (DDIT/ADIT, Central Circles) | Search/survey (132/133A) case notes, statement cross-ref, 69A/115BBE calculator |
| **Appeals** — CIT(A) / NFAC | Pending-appeals docket, hearing calendar, precedent-aware appellate-order drafts |
| **DRP** (Dispute Resolution Panel) | TP/international objections tracker, **144C 9-month clock**, panel notes |
| **TDS / Exemptions / Recovery** | Wing deadlines, notice templates, 234E/220(2) interest |
| **CA / Advocate** | Client matters, filing calendar, notice-response drafting, hearing reminders |
| **Taxpayer / Student** | Simplified Q&A, 80C-type calculators, learning mode |

---

## 4. P0 HERO — Limitation Calendar + Reminders

### 4.1 Why this first
- Most defensible: statutory-date computation is domain knowledge competitors don't encode.
- Most daily-use: it's the "open BT every morning" surface.
- Compounds every other feature: a matter with a live limitation clock pulls in notes, drafts, and reminders around it.

### 4.2 The statutory-date engine
A rules table maps a **trigger event** → **computed deadline(s)**. Rules are **configurable per assessment year** (limitation periods have changed across Finance Acts; never hard-code a single period). Each computed date carries: the governing section, the formula, the trigger source, and an editable override.

| Trigger event (user enters date) | Computed deadline | Governing provision |
|---|---|---|
| End of AY (for 143(3)/144) | Time-barring date for assessment | **Sec 153(1)** — period configurable per AY |
| Notice u/s 148 served | Reassessment time-barring | **Sec 153(2)** |
| Escaped income & AY | Last date to issue 148 (3 yr / up to 10 yr if ≥ ₹50L) | **Sec 149 / 148A** |
| Return filed | Last date to issue 143(2) | **Sec 143(2)** — 3 months from end of FY of filing |
| Notice date (142(1)/143(2)/SCN) | Compliance/response due date | as stated in notice |
| Draft assessment order (TP/international) | Objection window (30 days) + **DRP directions due (9 months)** + AO final order (1 month) | **Sec 144C** |
| Order served (assessment/penalty) | CIT(A) appeal last date — 30 days | **Sec 249** (Form 35) |
| CIT(A) order served | ITAT appeal last date — 60 days | **Sec 253** (Form 36) |
| ITAT order served | High Court appeal — 120 days | **Sec 260A** |
| Order sought to be rectified | Rectification limit — 4 yrs from end of FY | **Sec 154** |
| Order to be revised | 263 (2 yrs) / 264 application (1 yr) | **Sec 263 / 264** |
| Assessment/penalty proceedings completed | Penalty order limitation | **Sec 275** |

> **Build note:** ship the rules as **data, not code** (a `limitation_rule` table or YAML) so a tax SME can add/adjust periods per AY without a deploy. Always show the *governing section* next to each date so the officer can trust and verify it. The **Income-tax Act, 2025** re-numbers sections — keep a section-mapping layer so the engine can display either the 1961 or 2025 citation.

### 4.3 Calendar UX
- Views: **Month / Week / Agenda (list)**.
- Sources shown together: statutory deadlines, hearings, notice-compliance dates, personal tasks — color-coded by **matter** and by **category**.
- Each event → click opens the linked **matter**, its notes, drafts, and the source doc.
- Filters: by wing/category, by matter, by "next 7 / 30 days", by "at-risk" (deadline < N days).
- **At-risk banner** on the dashboard: "3 matters time-barring within 15 days."

### 4.4 Reminders
- Auto-created from statutory dates (default nudge offsets: T-30, T-7, T-1, T-0; configurable).
- Manual reminders: *"Reply to 142(1) notice — Due 31 Aug — Matter: ABC Pvt Ltd — doc: Notice.pdf."*
- Created inline from chat/notes: *"Remind me to verify this case tomorrow"* → parses to a dated reminder on the active matter.
- Delivery channels: in-app bell, email (daily "due today/this week" mail), and desktop-app toast for the Appeals app. Escalating.

### 4.5 Data model (indicative)
```
matter(id, user_id, org_id, title, pan, ay, appeal_no, wing, status, created_at)
limitation_rule(id, trigger_event, section_ref, ay_from, ay_to, period_value, period_unit, formula_note)
deadline(id, matter_id, rule_id|null, kind, trigger_date, due_date, section_ref, is_auto, overridden, notes)
reminder(id, user_id, matter_id|null, deadline_id|null, title, due_at, offsets[], channels[], status)
calendar_event(id, user_id, matter_id|null, kind, title, start, end, category, source_ref)
```

---

## 5. My Matters / Docket (P0)
The anchor object. A matter = a case the user is working (PAN / appeal no. / AY). Everything attaches to it: chats, notes, reminders, deadlines, drafts, uploaded docs, watchlist hits.
- List + detail view; status pipeline (Open → In progress → Awaiting order → Closed).
- "Attach to matter" available from any chat answer, note, calculator result, or upload.
- Matter timeline: a reverse-chron feed of everything that happened on the case.

---

## 6. Sticky Notes (P1)
Attach a note to **anything**: a matter, a statutory section, a specific chat answer, a citation, or an uploaded document paragraph. Each note auto-captures:
`case/matter · section · question · source/citation · date · user · related document`.
- Color-coded, full-text searchable, filterable by matter/section.
- A note can spawn a reminder ("remind me to verify this case tomorrow").
- Private by default; shareable within a team matter (see §10).

---

## 7. Personal Templates (P1)
User's reusable drafting templates, pre-wired to BT's cited drafting:
Show-cause notice · Assessment order (143(3)) · 142(1)/143(2)/148 notices · Appeal grounds (Form 35/36) · Penalty notice (271-series) · Remand report · DRP objections · Information request · Hearing notice.
- Templates carry placeholders (PAN, AY, amounts, section) auto-filled from the matter.
- BT fills the reasoning with grounded, cited paragraphs.

---

## 8. Statutory Calculator & Interest Engine (P1)
A dedicated **Calculators** entry in the sidebar under **TOOLS**. Opens as a **slide-over / split-screen panel** so the user never loses their current chat context (explicit UX requirement from the source doc).
Income-tax calculators:
- **Interest:** 234A / 234B / 234C (advance-tax default), **220(2)** (delay in payment), 234E (TDS statement).
- **Special-rate tax:** **115BBE** (60% + surcharge + cess on 68/69/69A/69B/69C additions).
- **Core:** slab tax (old vs new regime), surcharge + marginal relief, cess, rebate 87A.
- **Capital gains** (with indexation where applicable), **MAT/AMT**, **relief u/s 89**, advance-tax scheduler.
- Every result is explainable: shows the working + the governing section, and can be inserted into a draft or saved to a matter.

---

## 9. AIS / 26AS / TIS Reconciliation (P1) — the income-tax GSTR engine
Upload **AIS + 26AS + TIS + ITR + Form 16/16A** → auto-match with fuzzy logic (name/PAN/date/amount tolerances) → flag only genuine discrepancies:
- TDS credit claimed vs 26AS available; SFT/AIS entries not reflected in ITR; interest/dividend under-report; large cash deposits (68/69 exposure); mismatch between Form 16 and computation.
- Output: a reconciliation report with drill-down + "draft a query/notice on this mismatch" action (officer side) or "prepare explanation" (CA side).
- Same rationale as the GST doc's #1: the most repetitive, error-prone task → highest-leverage automation.

---

## 10. Collaboration (P2)
Make BT a **departmental / firm** tool, not just individual:
- Share a **matter** (with its notes, deadlines, drafts) within a range / circle / CA firm.
- Role-scoped permissions (view / comment / edit).
- Ties into existing seat = concurrent-session licensing.

---

## 11. Daily/Weekly Digest + Watchlists (P2)
- **Watchlists:** "alert me on new ITAT/HC/SC rulings touching Sec 68" or "this assessee's group" or "80-IA".
- **Digest:** personalized email/in-app feed of new circulars, notifications, and **fresh rulings** matched to saved matters/sections.
- **Leverage:** BT already runs daily case-law ingestion — this feature is largely a matching + delivery layer on top of it. Turns BT from a lookup tool into a habit.

---

## 12. Word / Excel plug-in (P2)
Officers live in Word (orders/notices) and Excel (computations). A sidebar add-in to query BT and insert **cited** answers without switching tabs. Taxmann already ships this; parity + our grounding/citation is the differentiator.

---

## 13. Why BharatTax beats other AI tools (positioning — reused in brochure)
1. **Grounded, every line cited** — click through to the exact section/rule/case. Generic LLMs hallucinate Indian tax law.
2. **India-tax corpus + daily-fresh rulings** — statutes, rules, circulars, ITAT/HC/SC, updated daily. Taxmann/Taxsutra are libraries; ChatGPT is stale.
3. **It knows *your* docket** — matters, deadlines, notes, watchlists. No other tool is personal to the officer. **The moat.**
4. **Original & IP-safe** — BT *synthesizes primary law*; it does not reproduce third-party commentary (internal copyright audit rated sample answers 1–2/10 reproduction risk). A clean IP story for a government buyer.
5. **Drafts, not just answers** — orders, notices, appellate drafts, remand reports.
6. **Built for government** — hosted & secured in India, role-based access, encrypted in transit and at rest; air-gap / on-prem on requirement.
7. **One workspace** — research → analyze → calculate → draft → verify → review, plus calendar/reminders/notes, in one place.

> Honesty guardrails (locked earlier): say "hosted and secured in India," "encrypted in transit and at rest," air-gap/on-prem "on requirement" — do **not** claim "data never leaves India / air-gapped by default / end-to-end encrypted" as standing facts.

---

## 14. Phasing

**Phase 1 (hero, ~first cut):** Matters/Docket + Limitation Calendar + Reminders + statutory-date engine (rules as data). Ship the "daily workspace" story.
**Phase 2:** Role-based dashboard + Sticky Notes + Personal Templates + Statutory Calculator/Interest Engine.
**Phase 3:** AIS/26AS Reconciliation + Digest/Watchlists (reuse ingestion) + Collaboration.
**Phase 4:** Word/Excel plug-in.

---

## 15. Data sources (income tax — from source doc)
- incometaxindia.gov.in — Income-tax Act (1961 & **2025**), Rules 1962, Circulars, Notifications, Finance Acts, Finance Bills, DTAA, press releases, all-acts.
- ITAT/HC/SC case law — via existing Indian Kanoon integration + daily ingestion.
- (Analytics only) data.gov.in income-tax datasets.
