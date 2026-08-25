# BharatTax — Role-Coverage Feature Roadmap

**Goal:** extend the workspace from ~3 well-served personas (AO-lite, CIT(A), CA) to every income-tax designation, and add the cross-cutting layers (portfolio dashboard, penalty/demand modules, approvals) that almost every role needs.

Execution model: build → PR → deploy → next, one feature at a time (as with the P0–P2 suite). Each item is a v1 scoped to ship.

---

## Phase A — Cross-cutting foundations (benefit *every* role)

| # | Feature | What it is |
|---|---------|-----------|
| A1 ✅ | **Workload / Portfolio Dashboard** *(shipped)* | One home board of ALL matters enriched with their next statutory deadline, sorted/filterable by time-barring / status / wing. Portfolio stats (overdue, due-this-week/month across the whole caseload). Doubles as the **role-aware home**. |
| A2 ✅ | **Penalty module** *(shipped)* | Draft + track penalty proceedings: 270A (under-/mis-reporting), 271AAC (115BBE income), 271(1)(c), 234E, with **Sec. 275 limitation** on the calendar. |
| A3 ✅ | **Notice-response drafting** *(shipped — template library)* | Reply to 142(1)/143(2)/148/SCN — grounds, submissions, cited defence — the CA/advocate mirror of the AO's notice drafting. |

## Phase B — Assessing-Officer depth

| B1 ✅ | **Assessment-order engine** *(shipped)* — issue-by-issue AO order (reason-for-selection → SCN → assessee reply → discussion → addition → computation → demand), cited, to DOCX (the appeals engine, AO-side). |
| B2 ✅ | **CASS questionnaire generator** *(shipped)* — LLM-drafted 142(1) questionnaire tailored to the CASS selection reason(s), from the Assessments page (reason picker + optional assessee/PAN/AY + specifics). |

## Phase C — Unserved wings (self-contained, quick wins)

| C1 ✅ | **TDS module** *(shipped — calculator + section reference)* — default calculator (short/non-deduction, **201(1A)** interest, **234E** fee), section picker (194C/J/I/195…). *Next: justification-report analysis.* |
| C2 ✅ | **Recovery / TRO module** *(shipped — instalment plan + recovery templates)* — 220(2) declining-balance instalment calculator; officer templates for 221(1) SCN, 226(3) garnishee, 222 TRO reference, 220(3) instalment order. *Next: outstanding-demand tracker.* |
| C3 ✅ | **Exemptions module** *(shipped — application/115BBC calculators + trust templates)* — Sec. 11 85%/15% application-shortfall calc; 115BBC anonymous-donations calc; templates for Form 10 (11(2)), Form 10AB (80G renewal), 12AB(4) cancellation SCN. *Next: 115TD accreted-income calc.* |

## Phase D — Specialist wings

| D1 🟡 | **Investigation** *(v1 shipped — peak-credit calc + templates)* — peak-credit/rotating-fund calculator; templates for 132(4) & 131 statement questionnaires, appraisal-report skeleton, undisclosed-income working note. *Next: seizure inventory, 153A/153C block-assessment engine, network mapping.* |
| D2 🟡 | **International Tax / TPO** *(v1 shipped — ALP calc + TP templates)* — Rule 10CA 35th–65th percentile / mean ALP benchmarking (TNMM), 5-method reference; TPO order u/s 92CA(3) + Form 3CEB review checklist. *Next: DTAA/PE/MLI lookup, working-capital adjustment.* |
| D3 ✅ | **DRP** *(shipped)* — 144C(13) final-order limitation on the calendar; templates for 144C(5) directions, objections-analysis panel note, and the final order u/s 143(3) r.w.s. 144C(13). |
| D4 | **I&CI** — SFT/AIS analytics at scale (high-value txns, mismatches, non-filer flags). |

## Phase E — Supervisory / administrative

| E1 ✅ | **Approval workflows** *(shipped — sanctions + 149 window)* — Sec. 149 reopening time-limit on the calendar; templates for 151 sanction (approve 148), 153D approval (search assessment). *Next: 148A approval queues.* |
| E2 ✅ | **Revision (263/264)** *(shipped)* — 263(2) 2-year & 264(3) 1-year limitation on the calendar; templates for 263 SCN, 263 revision order, 264 order. *Next: erroneous-&-prejudicial checklist.* |
| E3 ✅ | **Prosecution / Compounding** *(shipped — templates)* — SCN for proposed prosecution (Ch. XXII), sanction u/s 279(1), compounding application + compounding order u/s 279(2). *Next: compounding-fee helper.* |

## Cross-cutting enablers (parallel)

- **Role-tailored home** — the `category` tag reshapes the dashboard, nav emphasis, default templates & calculators per role. (A1 lays the groundwork.)
- **Document intelligence** — bank-statement analyzer (cash deposits, peak credit), P&L/balance-sheet reader, **AIS/26AS PDF parser** (upgrades reconciliation from manual paste).
- **CA/practitioner** — client grouping, filing calendar (ITR/TDS/advance-tax), grounds-of-appeal (Form 35/36) drafting.

---

## Sequencing rationale
A1 first (one build, every role benefits, makes the calendar usable at caseload scale). Then A2/A3 (penalty + notice-response — needed across AO and practitioner sides). Then B (largest user base), then C (self-contained wing wins), then D/E (specialist + supervisory). Document-intelligence and role-tailored-home run alongside as enablers.
