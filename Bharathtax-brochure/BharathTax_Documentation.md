# BharathTax — Documentation

Self-hosted, AI-powered Indian tax-research platform that answers questions grounded **only** in primary tax law (Income Tax Act / Rules / CBDT Circulars & Notifications) and user-uploaded documents. Every answer is citation-backed; if retrieval finds nothing relevant, the bot **refuses** rather than guessing.

---

## Table of contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Tech stack](#3-tech-stack)
4. [Repository layout](#4-repository-layout)
5. [Prerequisites](#5-prerequisites)
6. [Setup & first run](#6-setup--first-run)
7. [Running the application](#7-running-the-application)
8. [Workstream A — Application](#8-workstream-a--application)
9. [Workstream B — Ingestion pipeline](#9-workstream-b--ingestion-pipeline)
10. [Configuration & environment](#10-configuration--environment)
11. [Licensing model (seats)](#11-licensing-model-seats)
12. [Testing](#12-testing)
13. [Production deployment (GPU)](#13-production-deployment-gpu)
14. [Gotchas & operational notes](#14-gotchas--operational-notes)
15. [Roadmap & scope](#15-roadmap--scope)

---

## 1. Overview

BharathTax is a citation-grounded tax-research assistant for Indian tax law. It combines retrieval-augmented generation (RAG) with structure-aware parsing of statute text to produce answers that always link back to the exact source — section, sub-section, proviso, or Explanation.

Two workstreams, one system:
- **Workstream A — Application:** authentication, licensing, hybrid retrieval (dense + sparse), Ask Bot, document Q&A, admin console, audit log.
- **Workstream B — Data/Ingestion:** a configurable, re-runnable pipeline that turns primary tax law into a clean, chunked, embedded, indexed corpus.

**Multi-domain by design.** A `domain` axis maps to the taxmann.ai "Module" concept. The MVP ships `income_tax`; `gst`, `customs`, etc. are reserved extension points — adding one means editing `config/sources.yaml`, **not code**.

**Core guarantee — no hallucinations.** A grounding gate in [backend/app/services/rag.py](backend/app/services/rag.py) inspects retrieval before invoking the LLM. If nothing relevant is returned, the bot says so.

---

## 2. Architecture

`docker compose` orchestrates the following services:

| Service     | Role                                                         |
|-------------|--------------------------------------------------------------|
| `postgres`  | Primary store. Uses **pgvector** for dense vectors, GIN for FTS. |
| `redis`     | Celery broker / result backend.                              |
| `minio`     | Object storage for raw source files & user uploads.          |
| `ml-server` | FastAPI service hosting **bge-m3** embeddings + **bge-reranker-v2-m3**. |
| `api`       | FastAPI backend (auth, ask, documents, admin, history).      |
| `worker`    | Celery worker for ingestion pipeline jobs.                   |
| `beat`      | Celery beat scheduler for nightly re-runs.                   |
| `frontend`  | React + Vite + TypeScript + Tailwind UI.                     |

The LLM is **not** a container in dev — it sits behind an `LLMClient` interface ([backend/app/services/llm.py](backend/app/services/llm.py)) with three backends:

- `mock` — default; returns deterministic prose. No model required.
- `ollama` — dev path, e.g. `qwen2.5:3b-instruct` on the host.
- `vllm` — production path, e.g. `Qwen/Qwen2.5-14B-Instruct` with ≥24 GB VRAM.

Switching is an `.env` change (`LLM_BACKEND`); **no code change**.

### Request flow — Ask

```
frontend  →  api /ask
              │
              ▼
       retrieval service
       ├── dense: pgvector cosine over chunk embeddings
       ├── sparse: Postgres FTS (GIN tsvector)
       └── merge + bge-reranker-v2-m3
              │
              ▼
       parent-section expand (proviso/Explanation context)
              │
              ▼
       grounding gate  ──(no evidence)──►  refuse
              │
              ▼
            LLM
              │
              ▼
       answer + numbered citations
```

---

## 3. Tech stack

**Backend**
- FastAPI (Python) — `backend/app/`
- SQLAlchemy ORM + Pydantic schemas
- Alembic migrations
- Celery + Redis (workers & beat)
- bcrypt (auth; intentionally not `passlib` due to bcrypt 4.x incompatibility)

**Storage / search**
- PostgreSQL with `pgvector` extension (HNSW index for dense)
- Postgres FTS with GIN index for sparse
- MinIO (S3-compatible) for raw files

**ML stack** — `ml-server/`
- `torch==2.6.0` (pinned — transformers blocks `torch.load` of `.bin` on <2.6)
- `transformers==5.12.1` (FlagEmbedding's bge-m3 requires 5.x)
- **bge-m3** for dense embeddings
- **bge-reranker-v2-m3** run as a cross-encoder directly via transformers (not via `FlagReranker`, which breaks on transformers 5.x)

**Frontend**
- React + Vite + TypeScript + Tailwind CSS

**Infra**
- Docker Compose (CPU + GPU overlay)

---

## 4. Repository layout

```
config/sources.yaml          source registry (add a source here, never in code)
data/manual/                 drop PDFs/HTML here when a source can't be auto-fetched
data/cache/                  polite-crawl HTTP cache
backend/app/
  core/                      settings, db, security, logging, audit
  models/                    SQLAlchemy ORM
  schemas/                   Pydantic schemas
  api/routes/                auth, ask, documents, admin, history
  services/                  retrieval, rag, llm, embeddings, licensing, auth, audit
  ingestion/                 Workstream B: registry → fetch → extract → parse → chunk → embed → index
  tests/                     chunker, retrieval grounding, licensing
ml-server/                   self-hosted bge-m3 + reranker (FastAPI)
frontend/                    React + Vite + TS + Tailwind
scripts/                     fetch_seed_corpus.sh, dump/restore helpers
docker-compose.yml           CPU stack
docker-compose.gpu.yml       GPU overlay
Makefile                     up / down / migrate / seed / ingest / verify-corpus / test
```

---

## 5. Prerequisites

- **Docker Desktop** with WSL2 backend on Windows. Allocate **≥10–12 GB RAM** — bge-m3 (~2.3 GB) and the reranker (~2.3 GB) together exceed the 7.6 GB default. Settings → Resources, or `~/.wslconfig` → `[wsl2] memory=12GB`, then restart Docker.
- **~15 GB disk** for images plus model weights (cached in the `*_hfcache` volume).
- *(Optional)* NVIDIA GPU + NVIDIA Container Toolkit for production-grade LLM.

---

## 6. Setup & first run

```bash
cp .env.example .env                  # then change JWT_SECRET, POSTGRES_PASSWORD, MinIO keys
make up                               # build + start core stack (first run pulls images)
make migrate                          # create schema (pgvector ext, HNSW + GIN, tables)
make seed                             # demo dept/wings/seats + users
bash scripts/fetch_seed_corpus.sh     # download the 3 source PDFs into data/manual/
make ingest                           # parse → chunk → embed → index   (CPU: ~2–3 h; GPU: minutes)
make verify-corpus                    # asserts chunks + embeddings + indexes exist
```

**Faster path** — restore the provided DB dump instead of re-ingesting:

```bash
bash scripts/restore_corpus.sh handover/corpus_dump.sql
```

**Optional dev LLM** (host, not Docker):

```bash
ollama pull qwen2.5:3b-instruct
# in .env:  LLM_BACKEND=ollama
```

---

## 7. Running the application

- Frontend: **http://127.0.0.1:5173**
- API docs: **http://127.0.0.1:8000/docs**
- MinIO console: **http://127.0.0.1:9001**

> Use `127.0.0.1`, not `localhost`. On Windows, `localhost` resolves to IPv6 `::1` while Docker publishes on IPv4 — `localhost:PORT` can hang.

The first `/ask` after a restart is slow (~30–60 s) because ml-server lazy-loads model weights. Subsequent queries are fast.

### Seeded demo users

| Username   | Password    | Role          | Notes                              |
|------------|-------------|---------------|------------------------------------|
| admin      | admin123    | super_admin   | Full admin                         |
| wingadmin  | wing123     | wing_admin    | Manages wing seats                 |
| officer1   | officer123  | officer       | Wing *IT I&CI*, 5 seats            |
| officer2   | officer123  | officer       | Wing *IT I&CI*                     |
| auditor1   | auditor123  | auditor       | Read access for audit log          |

### Demo vertical slice

1. Log in as **officer1 / officer123**.
2. **Ask Bot** → pick Module *Income Tax* → ask e.g. *"What is the maximum deduction under section 80C?"* → grounded answer with `[n]` citations.
3. **Documents** → upload a notice (PDF), then ask questions scoped to it.
4. Log in as **wingadmin / wing123** → **Admin** shows the live seat pool; open several sessions to watch seats fill and logins block at the limit.

---

## 8. Workstream A — Application

### API routes — `backend/app/api/routes/`

| Route file       | Purpose                                                          |
|------------------|------------------------------------------------------------------|
| `auth.py`        | Login, logout, JWT issue, seat lease acquire/release.            |
| `ask.py`         | The Ask Bot endpoint: retrieval → grounding → LLM → citations.   |
| `documents.py`   | Upload a user document, scope Q&A to it.                         |
| `admin.py`       | Wing/seat management, source registry view, ingest status.       |
| `history.py`     | Per-user query history.                                          |

### Services — `backend/app/services/`

| Service          | Responsibility                                                   |
|------------------|------------------------------------------------------------------|
| `auth.py`        | bcrypt password hashing, JWT issue/verify.                       |
| `licensing.py`   | Seat pool, concurrent-session enforcement, blocks at limit.      |
| `retrieval.py`   | Dense (pgvector) + sparse (FTS) merge → bge-reranker → expand.   |
| `rag.py`         | Grounding gate + citation assembly + anti-hallucination refusal. |
| `llm.py`         | `LLMClient` interface; backends: `mock` / `ollama` / `vllm`.     |
| `embeddings.py`  | Calls the ml-server for bge-m3 embeddings.                       |
| `documents.py`   | User document upload, parse, embed-on-the-fly.                   |
| `storage.py`     | MinIO read/write wrapper.                                        |
| `audit.py`       | Append-only audit log (auth events, ask events).                 |

### Models — `backend/app/models/`

- `org.py` — Department, Wing, Seat pool.
- `corpus.py` — Source, Document (statute), Section, Chunk, Embedding.
- `documents.py` — User-uploaded documents and their chunks.
- `activity.py` — Audit log, query history, sessions.
- `enums.py` — Role, source type, domain, document status.

---

## 9. Workstream B — Ingestion pipeline

Sources are declared in [config/sources.yaml](config/sources.yaml). **Add a source by editing YAML, never code.**

### Pipeline stages

```
registry → fetch → extract → parse → chunk → embed → index
```

1. **Registry** — read `config/sources.yaml`; resolve enabled sources for the run.
2. **Fetch** — either `http_*` (polite-crawl, rate-limited, cached under `data/cache/`) or `manual` (read from `data/manual/...`).
3. **Extract** — PDF/HTML to plain text with layout preserved.
4. **Parse** — structure-aware: detect Chapter → Section → sub-section → proviso → Explanation. Profiles live in [backend/app/ingestion/parse/__init__.py](backend/app/ingestion/parse/__init__.py).
5. **Chunk** — `backend/app/ingestion/chunk.py`. Splits **on legal structure**, never blind windows. Each chunk gets a breadcrumb prefix (e.g. *"IT Act 1961 › Chapter VI-A › Section 80C › sub-section (2) › proviso"*). Provisos and Explanations are kept attached to their parent — never split.
6. **Embed** — call ml-server for bge-m3 dense vectors; store in pgvector.
7. **Index** — HNSW for dense, GIN/tsvector for sparse FTS.

### Properties

- **Idempotent & resume-safe** — content-hashed; re-runs ingest only new/changed chunks.
- **Multi-domain** — every row carries a `domain` column so retrieval can filter to the active Module.
- **Scheduled** — Celery beat re-runs nightly to pick up new circulars.

### Adding a new domain (e.g. GST)

1. Uncomment the `gst` block in `config/sources.yaml`.
2. Drop files in `data/manual/gst/...` (or supply `http_*` URLs).
3. Add a parser profile in [backend/app/ingestion/parse/__init__.py](backend/app/ingestion/parse/__init__.py) if the layout differs.
4. `make ingest`.

The `domain` column + Module filter already exist end-to-end.

### Why `data/manual/` exists

`incometaxindia.gov.in` blocks bots. The seed corpus is therefore fetched from India Code + dor.gov.in + the e-filing portal via `scripts/fetch_seed_corpus.sh` and dropped into `data/manual/`. The pipeline treats `manual` sources first-class.

### Verifying the corpus

```bash
make verify-corpus
```

Asserts that chunks exist for every enabled source, every chunk has an embedding, and HNSW + GIN indexes are present.

---

## 10. Configuration & environment

Primary config files:

- `.env` — secrets and runtime knobs (gitignored). Start from `.env.example`.
- `config/sources.yaml` — source registry (which statutes/circulars to ingest, and how).
- `docker-compose.yml` — CPU stack.
- `docker-compose.gpu.yml` — GPU overlay for production LLM.

Key environment variables:

| Variable               | Meaning                                                       |
|------------------------|---------------------------------------------------------------|
| `LLM_BACKEND`          | `mock` (default) / `ollama` / `vllm`                          |
| `LLM_MODEL_NAME`       | e.g. `qwen2.5:3b-instruct` or `Qwen/Qwen2.5-14B-Instruct`     |
| `ML_DEVICE`            | `cpu` (dev) / `cuda` (prod GPU)                               |
| `EMBED_MAX_LENGTH`     | `256` on CPU (cost cap); raise for GPU                        |
| `JWT_SECRET`           | Required. Change before any real deployment.                  |
| `POSTGRES_PASSWORD`    | Required.                                                     |
| `MINIO_ROOT_USER`      | Required.                                                     |
| `MINIO_ROOT_PASSWORD`  | Required.                                                     |
| `VITE_API_BASE_URL`    | Frontend → API base. Use `http://127.0.0.1:8000` in dev.       |

---

## 11. Licensing model (seats)

The platform is gated by a **department → wing → seat** hierarchy:

- A department contains one or more wings.
- A wing owns a fixed pool of **concurrent-session seats**.
- A user logging in **leases** one seat. When the pool is exhausted, further logins from that wing are blocked.
- Logout (or session expiry) releases the seat back to the pool.

This model is enforced in [backend/app/services/licensing.py](backend/app/services/licensing.py) and the demo seeds five seats for the *IT I&CI* wing so the behaviour is observable in `Admin` → **live seat pool**.

---

## 12. Testing

```bash
make test
```

Runs in the api container against Postgres:

- `test_chunker` — structure-aware chunking; provisos & Explanations are never split, breadcrumbs are correct.
- `test_retrieval_grounding` — anti-hallucination refusal path and citation assembly.
- `test_licensing` — concurrent-session seat pool blocks at the limit.

Status at hand-off: **11 / 11 passing** on the seeded corpus of 3,898 chunks.

---

## 13. Production deployment (GPU)

```bash
# .env:
#   LLM_BACKEND=vllm
#   LLM_MODEL_NAME=Qwen/Qwen2.5-14B-Instruct
#   ML_DEVICE=cuda

docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

Requirements:
- NVIDIA GPU with **≥24 GB VRAM** for the 14B model.
- NVIDIA Container Toolkit installed on the host.
- No code change between dev and prod — only `.env` + the compose overlay.

### Security checklist before going live

- [ ] Rotate `JWT_SECRET`, `POSTGRES_PASSWORD`, MinIO root keys.
- [ ] Put the API behind HTTPS + a reverse proxy (nginx / Caddy / Traefik).
- [ ] Tighten CORS (`*` is dev-only).
- [ ] Rate-limit `/auth/*` endpoints.
- [ ] Rotate seat-lease signing keys.
- [ ] Decide audit-log retention and back it up.
- [ ] Confirm data-residency requirements are satisfied by the host region.

---

## 14. Gotchas & operational notes

- **`localhost` vs `127.0.0.1`** — on Windows, `localhost` → IPv6 `::1` but Docker publishes on IPv4. Use `127.0.0.1`. The frontend API base is set via `VITE_API_BASE_URL`.
- **Docker RAM** — bge-m3 (~2.3 GB) + reranker (~2.3 GB) together exceed the 7.6 GB default and can OOM. Retrieval falls back to dense-only if the reranker dies, but raise the allocation for reliability.
- **Model warm-up** — models load lazily on the first embed/rerank call; expect 30–60 s on the very first `/ask` after a restart.
- **Pinned ML deps** — do not bump blindly:
  - `torch==2.6.0` — transformers blocks `torch.load` of `.bin` weights on <2.6.
  - `transformers==5.12.1` — bge-m3 via FlagEmbedding needs 5.x.
  - The reranker is run via **transformers directly** as a cross-encoder, **not** via FlagEmbedding's `FlagReranker` (which breaks on transformers 5.x).
- **Auth** — uses `bcrypt` directly, not `passlib` (which is broken on bcrypt 4.x).
- **`EMBED_MAX_LENGTH=256`** caps CPU embedding cost; raise it on GPU.
- **Internal name `taxmedha`** — the docker compose project name, Postgres db/user, and MinIO bucket are still `taxmedha` (historical — kept to preserve the already-ingested corpus). It is invisible to users. A fresh deploy can set these to `bharathtax` in `.env`/compose with no effect beyond cosmetics (and a re-ingest or dump-restore).

---

## 15. Roadmap & scope

### Done & verified live

- Full corpus ingested: 3,898 chunks across IT Act 1961 + Rules 1962 + CBDT Circular 06/2025.
- Hybrid retrieval (dense pgvector + sparse FTS) with bge-reranker-v2-m3.
- Grounded, cited answers with parent-section expansion.
- Exact-citation FTS lookup.
- Anti-hallucination refusal gate.
- Seat licensing — blocks at the limit, observable in admin console.
- 11 / 11 tests passing.

### Stubbed

- LLM prose generator — defaults to `mock`. Flip `LLM_BACKEND` to `ollama` or `vllm` for real text. **Retrieval, grounding, and citations are already real** — only prose synthesis is stubbed.

### Out of MVP scope (clean extension points already in code)

- Case-law / NJRS ingestion.
- Draft Bot (notice / order drafting).
- MS-Word add-in.
- PII redaction tool.
- SSO (SAML / OIDC).
- Multi-instance federation.
- Live auto-crawl of circulars (manual-drop works today; `http_*` fetchers are stubbed for per-source list crawling).

---

## Quick reference — Make targets

| Target              | Purpose                                                  |
|---------------------|----------------------------------------------------------|
| `make up`           | Build + start the core CPU stack.                        |
| `make down`         | Stop the stack.                                          |
| `make logs`         | Tail logs for all services.                              |
| `make build`        | Rebuild images.                                          |
| `make migrate`      | Apply Alembic migrations.                                |
| `make revision m="..."` | Autogenerate a new migration.                        |
| `make seed`         | Seed admin + demo wings/seats + users.                   |
| `make ingest`       | Run the Workstream B pipeline over enabled sources.      |
| `make verify-corpus`| Assert chunks / embeddings / indexes exist.              |
| `make test`         | Run backend tests in the api container against Postgres. |
| `make fmt`          | Format backend with ruff.                                |
