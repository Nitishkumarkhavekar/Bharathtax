# BharathTax — Handover / Developer Guide

The "how it really runs, gotchas already solved, what's next" companion to
[`README.md`](README.md). (Consolidates the former HANDOFF.md + HANDOVER.md.)

---

## 1. What it is (90 seconds)

Self-hosted, citation-grounded Indian income-tax assistant for officers. Ask a
question → it retrieves from **primary tax law + case law** (and, live, from
Indian Kanoon), and answers **with citations** — or refuses rather than
hallucinating (the core guarantee). Gated by a department/wing/**seat** licence
system. Surfaces today:

- **Ask Bot** — streamed, cited research over the corpus; per-user memory &
  personalization; a tool-calling agent that also pulls **live case law
  (SC/HC/ITAT)** from Indian Kanoon and current circulars from the web.
- **Documents** — upload a notice/order, ask questions scoped to that file.
- **Appeals** — draft CIT(A)/NFAC appellate orders, grounded on statutes + case
  law, exported to DOCX. Runs in the **dept desktop app** (data-security ask).
- **Drafting** — notices & orders (142(1), 143(2), show-cause, 154 …) →
  ITBA-ready DOCX.
- **Rulings** — case-law search over the judgment corpus.

Multi-domain by design (`domain` axis = taxmann.ai's "Module"): ships Income
Tax; GST/Customs are config-only additions, no code change.

## 2. Architecture / services

`docker compose` runs: **postgres** (pgvector), **redis** (Celery), **minio**
(raw files), **ml-server** (bge-m3 embeddings + bge-reranker-v2-m3, FastAPI),
**api** (FastAPI), **worker**/**beat** (Celery), **frontend** (React/Vite),
plus **documentserver**/**previewer** (OnlyOffice DOCX editing) and a
**litellm-tunnel-relay** in prod.

- **Grounded RAG LLM** is behind an `LLMClient` interface
  ([backend/app/services/llm.py](backend/app/services/llm.py)): `mock` (default,
  no model) | `ollama` (dev) | `vllm`/`openai` (prod). Swap via `.env` only.
  Prod = **vLLM Llama-3.1-8B-Instruct** on a GPU box, reached through a **LiteLLM
  gateway** over a reverse-SSH tunnel (`bharattax-rag` model does its own
  retrieval on the GPU side; the gateway strips incoming system prompts).
- **Chat agent + web + streaming** = **Gemini 2.5 Flash** (tool-calling,
  Google-Search grounding) — [services/agent.py](backend/app/services/agent.py),
  [services/gemini_search.py](backend/app/services/gemini_search.py). Streamed
  via `POST /ask/stream` (SSE: `status` → `delta` → `done`).
- **Live case law** = **Indian Kanoon API** —
  [services/indiankanoon.py](backend/app/services/indiankanoon.py), surfaced as
  the `search_case_law` agent tool.

Request flow (Ask): `frontend → /ask (or /ask/stream) → agent picks tools
(search_tax_law corpus / search_case_law / web_search) → grounding + citation
assembly → answer`. Grounding gate + refusal + citation parsing live in
[services/rag.py](backend/app/services/rag.py).

## 3. Run it locally (5 minutes)

```bash
cp .env.example .env       # change JWT_SECRET, POSTGRES_PASSWORD, MinIO keys
make up                    # build + start the stack (first run pulls images)
make migrate               # apply DB migrations (Alembic)
make seed                  # admin user + demo wings/seats
```

- Frontend: **http://127.0.0.1:5173** (use `127.0.0.1`, not `localhost` — §5)
  · API docs: http://127.0.0.1:8000/docs · MinIO: http://127.0.0.1:9001
- Demo logins: `admin/admin123` (super_admin), `wingadmin/wing123`,
  `officer1/officer123`, `officer2/officer123`, `auditor1/auditor123`.
- Backend is volume-mounted — after editing Python, `docker compose restart
  api worker`. First `/ask` after a restart is slow (~30–60 s): ml-server
  lazy-loads the models on first use.

**Faster corpus:** restore the provided DB dump instead of re-ingesting —
`bash scripts/restore_corpus.sh handover/corpus_dump.sql`.

## 4. Not in git (obtain separately)

| Item | Why excluded | What to do |
|---|---|---|
| `.env` | secrets (LLM/Gemini/IndianKanoon keys, DB/MinIO creds) | copy `.env.example` → `.env`, fill in |
| `data/manual/**` | large source PDFs (statutes, judgments) | get the corpus drop; place per `config/sources.yaml` |
| `handover/corpus_dump.sql` | 58 MB DB dump | restore it, or `make migrate && make seed` for a fresh DB |

### Feature flags (env)
- `LLM_BACKEND` — `mock` | `ollama` | `vllm` | `openai`.
- `CHAT_AGENT_ENABLED=1` + `GEMINI_API_KEY` — the tool-calling agent (prod uses this).
- `WEB_SEARCH_ENABLED=1` — Gemini + Google-Search fallback.
- `INDIANKANOON_API_TOKEN` — live case-law fetch (dormant until set); pay-per-call, cached, `INDIANKANOON_MAX_DOCS` caps full-doc fetches.
- `WEB_SOURCE_ALLOWLIST` — override the officer-grade source allowlist (gov/courts/Indian Kanoon/ITAT/major legal press; consumer blogs dropped).
- `CORS_ALLOWED_ORIGINS` — comma-separated; `*` only in dev.

## 5. Gotchas already solved (don't re-discover these)

- **`localhost` vs `127.0.0.1`:** on Windows `localhost`→IPv6 `::1` but Docker
  publishes IPv4, so `localhost:PORT` can hang. Use `127.0.0.1`.
- **Docker RAM:** bge-m3 (~2.3 GB) + reranker (~2.3 GB) need headroom; the
  ~7.6 GB default can OOM. Retrieval falls back to dense-only if the reranker
  dies; raise RAM for reliability.
- **Pinned ML deps** ([ml-server/requirements.txt](ml-server/requirements.txt)) —
  don't bump blindly: `torch==2.6.0`, `transformers==5.12.1`. The reranker runs
  via transformers directly (cross-encoder), NOT FlagEmbedding's `FlagReranker`.
- **Auth:** uses `bcrypt` directly (not `passlib`, which breaks on bcrypt 4.x).
- **Internal name = `taxmedha`:** compose project, Postgres db/user, and MinIO
  bucket are historically `taxmedha` (kept to preserve the ingested corpus).
  Invisible to users; a fresh deploy can rename in `.env`/compose.
- **Gateway strips system prompts:** the prod LLM gateway drops incoming system
  prompts, so personalization is injected as a prior history turn, not system.

## 6. Production deploy (cstrax)

Prod = the **cstrax** VPS (`ssh cstrax`, repo `/opt/bharathtax`), served at
**https://bharattax.wenvia.global** (host nginx → api `:8000` / frontend `:5174`
/ OnlyOffice `:8095`). Backend is bind-mounted (git pull + restart); frontend is
a built image.

- **Compose is v1** (`docker-compose`, hyphenated), project `-p bharathtax-web`,
  3 files: `docker-compose.yml -f docker-compose.web.yml -f
  docker-compose.frontend-override.yml`. NOT `docker compose` v2.
- **api double-port-bind:** base + web compose both declare `api: ports` →
  v1 concatenates → both binds fail. `frontend-override.yml` pins a single
  `api: ports: !override ["127.0.0.1:8000:8000"]`. A plain `docker restart` is
  safe; a `docker-compose up` relies on this override.
- **Env changes need a container recreate**, not just restart (`env_file` is read
  at create time): `docker-compose … up -d --no-deps --force-recreate api`.
- **Alembic has drifted** (prod `alembic_version` is off the versioned chain), so
  new tables/columns are added idempotently at boot in
  [backend/app/main.py](backend/app/main.py) (`_ensure_admin_tables` create_all +
  `_patch_user_columns` ADD COLUMN IF NOT EXISTS), not via `alembic upgrade`.
- **CORS stays permissive** on purpose: the desktop app serves its UI from
  `file://` (Origin `null`) and uses browser fetch, so `assert_prod_safe()` only
  WARNS on wildcard CORS (secrets are still fatal-if-default).

## 7. The corpus (Workstream B)

- Sources declared in [config/sources.yaml](config/sources.yaml) — **add a source
  by editing YAML, never code.** Structure-aware parser/chunker splits on legal
  structure (Section → sub-section → proviso/Explanation), never blind windows,
  and prefixes each chunk with a breadcrumb.
- **Primary law:** drop under `data/manual/` per the config, then `make ingest`
  and `make verify-corpus`.
- **Case law:** drop judgment PDFs into `data/manual/case_law/` (+ optional
  `manifest.jsonl`), then **Admin → Corpus → Ingest case law** or the worker
  one-liner in [docs/case_law_corpus.md](docs/case_law_corpus.md). Idempotent
  (checksum dedup). Note: we hold SC + HC; ITAT is served **live** via Indian
  Kanoon rather than pre-ingested (batch ingest still possible — see
  `docs/`). Check state: **Admin → Corpus** or `GET /admin/corpus/stats`.

## 8. Open items

- [ ] **Get the team committing to git, not editing prod directly.** (A ~2000-line
      batch of prod-only work was folded into master on 2026-07-27; don't let it
      recur — every prod edit should land in a branch.)
- [ ] **Proper CORS allowlist** (web origin + desktop `null`) once the desktop
      CORS contract is confirmed — then flip `assert_prod_safe` back to fatal.
- [ ] **Reconcile the Alembic drift** (stamp prod to a real head) so migrations
      run normally again.
- [ ] **Assessment/penalty order templates** for the Drafting suite (need
      appeal-style reasoning, not fill-in-facts).
- [ ] **Batch-ingest ITAT** into the corpus for the high-frequency tail (live
      fetch covers the rest).

## 9. Tests & CI

`make test` (in the api container against Postgres): structure-aware chunker,
retrieval grounding / anti-hallucination refusal + citations, seat licensing.
CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs ruff bug-rules,
`compileall`, an Alembic single-head check, a secret guard, and the frontend
build.
