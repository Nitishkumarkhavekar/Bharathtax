# BharathTax — Consolidation & Competitive Uplift Plan

> Single product = **BharathTax** (this repo). We fold in the unique value from the separate
> `appeal` prototype and lift the UI to beat Taxmann.ai / Taxmann.com / Taxsutra.com.
> `appeal` is **not** a second product — it's a source of two features BharathTax is missing.

## Why consolidate
BharathTax already has the stronger research core: **bge-m3 embeddings + bge-reranker-v2-m3**,
hybrid dense (pgvector HNSW) + sparse (FTS) retrieval, structure-aware legal chunker, grounding-gate
refusal, **dept/wing/seat licensing**, audit, config-driven multi-domain ingestion, Alembic, ml-server,
React/Vite. The `appeal` prototype rebuilt weaker versions of the same (MiniLM, no reranker). So we keep
BharathTax and port only what it lacks.

## What we take from `appeal` (the unique gold)
1. **Appeal Draft module** — the CIT(A)/NFAC appeal-order drafting workflow: 6 modules (Deficiency,
   Scope, Document-compliance, Issue-matrix, issue-wise Drafting, Assembly), per-issue regenerate +
   draft versions, citation audit, **DOCX export**. (BharathTax roadmap calls this the unbuilt "Draft Bot".)
   Source: `appeal/appeal_tool/{pipeline,prompts,export,ingest}.py`.
2. **Case-law corpus + acquisition** — bulk income-tax HC judgments from AWS Open Data + Rulings search.
   Source: `appeal/rag/fetch_hc_judgments.py`. (BharathTax roadmap calls this "case-law/NJRS ingestion".)

## How they map onto BharathTax (reuse, don't rebuild)
| Appeal piece | BharathTax reuse |
|---|---|
| MiniLM retrieval | **`services/retrieval.retrieve(db, q, domain=...)`** (bge-m3 + reranker) |
| LLM adapter | **`services/llm.get_llm().complete(system, user)`** (Gemini via `LLM_BACKEND=openai`) |
| roles/auth | **JWT + seat lease**, `role`/`wing_id`, current-user dependency |
| corpus store/index | existing **corpus/chunk tables + pgvector HNSW + FTS**; case law = a new **Domain** |
| jobs | existing **Celery** worker |
| migrations | **Alembic** (`make revision` / `make migrate`) |

## Workstreams (epics)

### W1 — UI uplift (shadcn/ui + Tailwind) — *highest visible priority*
- Add **shadcn/ui** (Radix + Tailwind) design system to `frontend/`: theme tokens, `cn()` util,
  base components (Button, Input, Card, Table, Dialog, Tabs, Toast, Sidebar, Badge, Select, Textarea).
- New **app shell**: branded sidebar + topbar, role-aware nav, command palette later.
- Restyle existing pages (Login, Ask, Documents, History, Admin) to premium standard; Ask becomes a
  proper chat with source cards (like the Taxmann.ai screenshot, but cited & grounded).
- Officer vs admin areas cleanly separated (BharathTax roles already exist).

### W2 — Appeal Draft module (backend)
- Models: `AppealCase`, `AppealDocument`, `AppealRun`, `AppealOutput` (Alembic migration). Case files in
  MinIO via existing `storage`; per-case private namespace reuses the document-Q&A path.
- Service `services/appeal_draft.py`: port the 6-module pipeline; ground each issue via
  `retrieval.retrieve(..., domain=...)`; generate via `get_llm()`. DOCX via ported `export.py`.
- Routes `api/routes/appeal.py`: cases CRUD, upload, run (Celery), outputs, regenerate, reassemble,
  export.docx, feedback. Protected by current-user; audit each action.

### W3 — Case-law domain + Rulings
- Add `Domain.CASE_LAW`; ingest judgments under it (port `fetch_hc_judgments` as an admin acquisition
  action + ingestion source). Rulings search = `retrieve(domain=CASE_LAW)`.

### W4 — Appeal Draft UI + Rulings UI (shadcn)
- Officer: Cases dashboard, Case workspace (6-module outputs, per-issue regenerate, citation audit,
  draft editor, DOCX), Rulings explorer. Reuses the W1 design system.

### W5 — Hardening parity / cleanup
- Bring over anything still missing (usage/cost view, feedback→fine-tuning export) if not already present;
  retire the `appeal` repo once parity is reached.

## Sequence
**W1 (UI foundation + shell + restyle Ask/Login) → W2 (Appeal Draft backend) → W4 draft UI →
W3 case-law + Rulings → W5 cleanup.** Each is shippable and reuses BharathTax's RAG/auth/licensing.

## Dev workflow (Docker)
- Backend code is volume-mounted; after edits: `docker compose restart api worker`.
- New tables: edit models → `make revision m="..."` → `make migrate`.
- Frontend: Vite HMR (volume-mounted); new deps → rebuild the `frontend` image (`docker compose up -d --build frontend`).
- LLM: set `LLM_BACKEND=openai`, `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`,
  `LLM_MODEL_NAME=gemini-2.5-flash`, `LLM_API_KEY=…` in `.env` for real answers.
