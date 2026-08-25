# BharatTax — Role-Coverage Feature Roadmap

**Goal:** extend the workspace from ~3 well-served personas (AO-lite, CIT(A), CA) to every income-tax designation, and add the cross-cutting layers (portfolio dashboard, penalty/demand modules, approvals) that almost every role needs.

Execution model: build → PR → deploy → next, one feature at a time (as with the P0–P2 suite). Each item is a v1 scoped to ship.

---

## Phase A — Cross-cutting foundations (benefit *every* role)

| # | Feature | What it is |
|---|---------|-----------|
| A1 | **Workload / Portfolio Dashboard** *(building first)* | One home board of ALL matters enriched with their next statutory deadline, sorted/filterable by time-barring / status / wing. Portfolio stats (overdue, due-this-week/month across the whole caseload). Doubles as the **role-aware home**. |
| A2 | **Penalty module** | Draft + track penalty proceedings: 270A (under-/mis-reporting), 271AAC (115BBE income), 271(1)(c), 234E, with **Sec. 275 limitation** on the calendar. |
| A3 | **Notice-response drafting** (practitioner inverse) | Reply to 142(1)/143(2)/148/SCN — grounds, submissions, cited defence — the CA/advocate mirror of the AO's notice drafting. |

## Phase B — Assessing-Officer depth

| B1 | **Assessment-order engine** — issue-by-issue AO order (reason-for-selection → SCN → assessee reply → discussion → addition → computation → demand), cited, to DOCX (the appeals engine, AO-side). |
| B2 | **CASS questionnaire generator** — 142(1) tailored to the selection reason (cash deposits, large deductions, mismatch). |

## Phase C — Unserved wings (self-contained, quick wins)

| C1 | **TDS module** — default calculator (short/non-deduction, **201(1A)** interest, **234E** fee), section picker (194C/J/I/195…), justification-report analysis. |
| C2 | **Recovery / TRO module** — outstanding-demand tracker, 220(2) interest (have calc), 220(6) stay, installments, attachment/garnishee (222/226(3)) drafting. |
| C3 | **Exemptions module** — trust/charity compliance: 11/12/13 application & accumulation (11(2)), 12A/80G registration & renewal (Form 10A/10AB), 115BBC. |

## Phase D — Specialist wings

| D1 | **Investigation** — appraisal-report builder, statement (132(4)/131) questionnaire, seizure/valuation inventory, unaccounted-income computation (peak credit, telescoping), 153A/153C block assessment, entity/network mapping. |
| D2 | **International Tax / TPO** — ALP method picker (CUP/TNMM/RPM/CPM/PSM), benchmarking helper, DTAA article + MLI/POEM/PE lookup, Form 3CEB review. |
| D3 | **DRP** — TPO methodology/comparables analysis, panel notes, 144C(5) directions drafting. |
| D4 | **I&CI** — SFT/AIS analytics at scale (high-value txns, mismatches, non-filer flags). |

## Phase E — Supervisory / administrative

| E1 | **Approval workflows** — 151 (reopening sanction), 153D (search-assessment approval), 148A queues with the draft + supporting; range monitoring. |
| E2 | **Revision (263/264)** — flag erroneous-&-prejudicial orders, 2-year limitation, revision-order drafting. |
| E3 | **Prosecution / Compounding** — complaint/sanction drafting, compounding application + fee. |

## Cross-cutting enablers (parallel)

- **Role-tailored home** — the `category` tag reshapes the dashboard, nav emphasis, default templates & calculators per role. (A1 lays the groundwork.)
- **Document intelligence** — bank-statement analyzer (cash deposits, peak credit), P&L/balance-sheet reader, **AIS/26AS PDF parser** (upgrades reconciliation from manual paste).
- **CA/practitioner** — client grouping, filing calendar (ITR/TDS/advance-tax), grounds-of-appeal (Form 35/36) drafting.

---

## Sequencing rationale
A1 first (one build, every role benefits, makes the calendar usable at caseload scale). Then A2/A3 (penalty + notice-response — needed across AO and practitioner sides). Then B (largest user base), then C (self-contained wing wins), then D/E (specialist + supervisory). Document-intelligence and role-tailored-home run alongside as enablers.
