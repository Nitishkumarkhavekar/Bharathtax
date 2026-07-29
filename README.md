# BharathTax

Self-hosted, AI-powered tax-research platform grounded **only** in primary
Indian tax law (Income Tax Act / Rules / CBDT Circulars & Notifications) plus
user-uploaded documents. Every answer is citation-backed and traceable to the
exact source; if retrieval finds nothing relevant, the bot says so — it never
answers from the model's own knowledge.

Two workstreams, one system:
- **Workstream A — Application:** auth/licensing, hybrid RAG, **Ask Bot**
  (streamed, cited answers with per-user memory & personalization; live
  case-law lookup via Indian Kanoon for SC/HC/ITAT), document Q&A, **Appeals**
  (CIT(A)/NFAC order drafting → DOCX; runs in the dept desktop app), **Drafting**
  (notices & orders u/s 142(1)/143(2)/154 etc. → ITBA-ready DOCX), **Rulings**
  (case-law search), admin console, audit log.
- **Workstream B — Data/Ingestion:** a configurable, re-runnable pipeline that
  turns primary tax law **and case law** into a clean, chunked, embedded,
  indexed corpus.

See [`HANDOVER.md`](HANDOVER.md) for the run guide, env/corpus notes, and the
current open-items list.

Multi-domain by design (a `domain` axis = the taxmann.ai "Module" concept):
the MVP ships `income_tax`; `gst`, `customs`, etc. are reserved extension
points — adding one means editing `config/sources.yaml`, not code.

## Hardware

| | Dev (this laptop) | Production |
|---|---|---|
| Embeddings / reranker | bge-m3 + bge-reranker-v2-m3 on **CPU** | on GPU (ml-server) |
| Grounded RAG LLM | `mock` / small Ollama model | **vLLM Llama-3.1-8B-Instruct** on the GPU box, reached via a LiteLLM gateway (reverse-SSH tunnel) |
| Web/agent + streaming | — | **Gemini 2.5 Flash** (tool-calling agent, Google-Search grounding) |
| Live case law | — | **Indian Kanoon API** (SC / HC / ITAT) |

The grounded LLM sits behind an `LLMClient` interface — switching dev→prod is an
`.env` change (`LLM_BACKEND`), **no code change**. The chat agent, web search,
and case-law fetch are feature-flagged on top (`CHAT_AGENT_ENABLED`,
`WEB_SEARCH_ENABLED`, `INDIANKANOON_API_TOKEN`).

## Layout

```
config/sources.yaml     source registry (add a source here, never in code)
data/manual/            drop PDFs/HTML here when a source can't be auto-fetched
data/cache/             polite-crawl HTTP cache
backend/app/
  core/                 settings, db, security, logging, audit
  models/ schemas/      SQLAlchemy ORM + Pydantic
  api/routes/           auth, ask, documents, admin, history, appeal, rulings, assist
  services/             retrieval, rag, llm, embeddings, licensing, auth, audit
  ingestion/            Workstream B: registry→fetch→extract→parse→chunk→embed→index
ml-server/              self-hosted bge-m3 embeddings + reranker (FastAPI)
frontend/               React + Vite + TS + Tailwind
```

## Setup

```bash
cp .env.example .env          # then edit secrets/model names
make up                       # build + start core stack (CPU)
make migrate                  # create schema
make seed                     # admin user + demo wings/seats
```

Optional dev LLM (host, not Docker):
```bash
ollama pull qwen2.5:3b-instruct
# set in .env:  LLM_BACKEND=ollama
```

## Populate the corpus (Workstream B)

1. Drop source files under `data/manual/` per the `manual_glob` paths in
   `config/sources.yaml` (e.g. `data/manual/income_tax/act_1961/...`).
2. Run and verify:
   ```bash
   make ingest          # fetch/extract/parse/chunk/embed/index
   make verify-corpus   # assert chunks + embeddings + HNSW/GIN indexes exist
   ```

## Use

- Frontend: http://localhost:5173 — log in, ask a question, get a cited answer,
  upload a notice and ask about it.
- API docs: http://localhost:8000/docs
- MinIO console: http://localhost:9001

### Demo vertical slice

After `make up && make migrate && make seed` (and, once embedded, `make ingest`):

1. Log in as **officer1 / officer123** (wing *IT I&CI*, 5 seats).
2. **Ask Bot** → pick Module *Income Tax*, ask e.g. *"What is the maximum
   deduction under section 80C?"* → grounded answer with `[n]` citations linking
   back to the exact section/source. If nothing relevant is found, the bot
   refuses rather than guessing.
   Either box has an **Improve prompt** button that rewrites a rough query into a
   precise, professional one (retrieval-free; never invents sections/facts).
3. **Documents** → upload a notice (PDF), then ask questions scoped to it.
4. **Appeals** → create a case, upload the order/grounds, run a draft → grounded,
   cited appellate order, editable per-issue, export to DOCX.
5. **Rulings** → search the case-law corpus by issue.
6. Log in as **wingadmin / wing123** → **Admin** shows the live seat pool (open
   several sessions to watch a wing's seats fill) and the **Corpus** card
   (chunks by domain + case-law ingest).

Demo users (seeded): `admin/admin123` (super_admin), `wingadmin/wing123`
(wing_admin), `officer1/officer123`, `officer2/officer123`, `auditor1/auditor123`.

### Tests

`make test` runs in the api container against Postgres:
- `test_chunker` — structure-aware chunking (provisos/Explanations never split)
- `test_retrieval_grounding` — anti-hallucination refusal + citation assembly
- `test_licensing` — concurrent-session seat pool blocks at the limit

## GPU production

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
# .env: LLM_BACKEND=vllm  LLM_MODEL_NAME=Qwen/Qwen2.5-14B-Instruct  ML_DEVICE=cuda
```

## Out of MVP scope (clean extension points left in code)

MS-Word add-in, redaction tool, SSO, multi-instance federation, GST/Customs
domains (config-only additions).

(Case-law search, live ITAT lookup, the Appeals draft workflow, the Drafting
suite, streamed chat, and per-user memory — formerly out of scope — have since
shipped; see [`HANDOVER.md`](HANDOVER.md).)
