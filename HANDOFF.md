# BharathTax — Developer Handover

Onboarding doc for picking up the project. Pairs with [README.md](README.md)
(layout + setup) — this file covers the **non-obvious** parts: how it really
runs, the gotchas already solved, how the corpus was built, and what's next.

---

## 1. What it is (90 seconds)

Self-hosted, citation-grounded tax-research assistant. Ask a question → it
retrieves from **primary Indian tax law only** (Income Tax Act/Rules + CBDT
circulars), reranks, and answers **with citations** to the exact section. If
nothing relevant is found it **refuses** rather than hallucinating (the core
guarantee). Gated by a department/wing/**seat** licence system.

Two workstreams, one DB:
- **A — Application:** auth/licensing, hybrid RAG, Ask Bot, doc Q&A, admin, audit.
- **B — Ingestion:** config-driven, re-runnable pipeline that turns law PDFs into
  a chunked, embedded, indexed corpus.

It's **multi-domain by design** (`domain` axis = taxmann.ai's "Module"): ships
Income Tax; GST/Customs are config-only additions, no code change.

## 2. Architecture / services

`docker compose` runs: **postgres** (pgvector), **redis** (Celery), **minio**
(raw files), **ml-server** (bge-m3 embeddings + bge-reranker-v2-m3, FastAPI),
**api** (FastAPI app), **worker**/**beat** (Celery ingest + scheduled jobs),
**frontend** (React/Vite). The LLM is **not** a container in dev — it's behind an
`LLMClient` interface ([backend/app/services/llm.py](backend/app/services/llm.py)):
`mock` (default, no model) | `ollama` (dev) | `vllm` (prod). Swap via `.env` only.

Request flow (Ask): `frontend → api /ask → retrieval (dense pgvector + sparse
Postgres FTS → merge → bge-reranker → parent-section expand) → grounding gate →
LLM → answer + citations`. Grounding gate + refusal live in
[backend/app/services/rag.py](backend/app/services/rag.py).

## 3. Prerequisites

- **Docker Desktop** (WSL2 backend on Windows). Give it **≥10–12 GB RAM**
  (default ~7.6 GB is tight for both ML models — see Gotchas). Settings →
  Resources, or `~/.wslconfig` → `[wsl2] memory=12GB`, then restart Docker.
- ~**15 GB disk** (images + model weights cached in the `*_hfcache` volume).
- Optional: NVIDIA GPU for production-grade LLM (see §8).

## 4. First-time setup

```bash
cp .env.example .env            # then change secrets (JWT_SECRET, POSTGRES_PASSWORD, MinIO keys)
make up                         # build + start the stack (first run pulls images)
make migrate                    # create schema (pgvector ext, HNSW + GIN, tables)
make seed                       # demo dept/wings/seats + users
bash scripts/fetch_seed_corpus.sh   # download the 3 source PDFs into data/manual/
make ingest                     # parse → chunk → embed → index   (CPU: ~2–3 h; GPU: minutes)
make verify-corpus              # asserts chunks + embeddings + indexes exist
```

**Faster path:** restore the provided DB dump instead of re-ingesting —
`bash scripts/restore_corpus.sh handover/corpus_dump.sql` (skips the long embed).

## 5. Running it

- Frontend: **http://127.0.0.1:5173**  (use `127.0.0.1`, not `localhost` — §7)
- API docs: http://127.0.0.1:8000/docs   ·   MinIO: http://127.0.0.1:9001
- Demo logins: `officer1/officer123`, `wingadmin/wing123`, `admin/admin123`.
- First `/ask` after a restart is slow (~30–60 s) — ml-server lazy-loads the
  models on first use; subsequent queries are fast.

## 6. The corpus (Workstream B)

- Sources are declared in [config/sources.yaml](config/sources.yaml) — **add a
  source by editing YAML, never code.** Each can be auto-crawled (`http_*`,
  polite/rate-limited) or dropped in `data/manual/` (`manual`) when the site
  blocks bots (incometaxindia.gov.in does — that's why the seed uses India Code +
  dor.gov.in + the e-filing portal).
- The structure-aware parser/chunker
  ([backend/app/ingestion/parse/](backend/app/ingestion/), [chunk.py](backend/app/ingestion/chunk.py))
  splits on legal structure (Section → sub-section → proviso/Explanation), never
  blind windows, and prefixes each chunk with a breadcrumb. It's validated on the
  real 880-page Act (see [tests](backend/app/tests/test_chunker.py)).
- **Add a new domain (e.g. GST):** uncomment its block in `sources.yaml`, drop
  files in `data/manual/gst/...`, add a parser profile in
  [parse/__init__.py](backend/app/ingestion/parse/__init__.py) if its layout
  differs, `make ingest`. The `domain` column + Module filter already exist.
- Incremental updates: Celery beat re-runs the (idempotent, resume-safe) pipeline
  nightly to pick up new circulars — only new checksums are ingested.

## 7. Gotchas already solved (don't re-discover these)

- **`localhost` vs `127.0.0.1`:** on Windows, `localhost`→IPv6 `::1` but Docker
  publishes on IPv4, so `localhost:PORT` can hang. **Use `127.0.0.1`.** Frontend
  API base is set via `VITE_API_BASE_URL` in `.env`.
- **Docker RAM:** bge-m3 (~2.3 GB) + reranker (~2.3 GB) together need headroom;
  the 7.6 GB default can OOM. Retrieval has a graceful fallback (dense-only) if
  the reranker dies, but raise the RAM allocation for reliability.
- **Model warm-up:** models load lazily on first embed/rerank call.
- **Pinned ML deps (in [ml-server/requirements.txt](ml-server/requirements.txt)) —
  do not bump blindly:** `torch==2.6.0` (transformers blocks `torch.load` of
  `.bin` on <2.6), `transformers==5.12.1` (FlagEmbedding's bge-m3 needs 5.x). The
  reranker is run via **transformers directly** (a cross-encoder in
  [ml-server/app.py](ml-server/app.py)), NOT FlagEmbedding's `FlagReranker`, which
  breaks on transformers 5.x.
- **Auth:** uses `bcrypt` directly (not `passlib`, which breaks on bcrypt 4.x).
- **`EMBED_MAX_LENGTH=256`** caps CPU embedding cost; raise for GPU.
- **Internal name = `taxmedha`:** the docker compose project name, Postgres
  db/user, and MinIO bucket are still `taxmedha` (historical — kept to preserve
  the already-ingested corpus on the origin machine). It's invisible to users.
  A fresh deploy can set these to `bharathtax` in `.env`/compose with no effect
  beyond cosmetics (and a re-ingest or dump-restore).

## 8. Production path

- **LLM:** set `LLM_BACKEND=vllm`, `LLM_MODEL_NAME=Qwen/Qwen2.5-14B-Instruct`,
  `ML_DEVICE=cuda` in `.env`, then
  `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d`
  (needs a ≥24 GB-VRAM GPU + NVIDIA Container Toolkit). No code change.
- **Secrets:** change `JWT_SECRET`, `POSTGRES_PASSWORD`, MinIO keys before any
  real deployment. `.env` is gitignored; `.env.example` holds placeholders only.
- **Security TODO before prod:** HTTPS/reverse proxy, tighten CORS (currently
  `*` for dev), rate-limit auth, rotate seat-lease secrets, set data-residency
  enforcement, review audit-log retention.

## 9. Status & roadmap

**Done & verified live:** full corpus (3,898 chunks), grounded+cited answers,
exact-citation FTS lookup, anti-hallucination refusal, seat licensing (blocks at
limit), 11/11 tests. **Stubbed:** LLM prose (`mock`) — flip to Ollama/vLLM for
real text; retrieval/grounding/citations are already real.

**Out of MVP scope (clean extension points exist):** case-law/NJRS ingestion,
Draft Bot, MS-Word add-in, redaction tool, SSO, multi-instance federation,
live auto-crawl of circulars (manual-drop works today; `http_*` fetchers are
stubbed for per-source list crawling).

## 10. Tests

`make test` (runs in the api container against Postgres): structure-aware
chunker, retrieval grounding/anti-hallucination, seat licensing.
