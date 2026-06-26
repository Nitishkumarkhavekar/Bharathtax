# BharathTax — Handover

Owner going forward: **Anand (@anandkaman)** — full admin on this repo.
This doc is the "what changed, how to run, what's left" companion to
[`README.md`](README.md) (full architecture) and [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md).

---

## 1. What this is

Self-hosted, AI-powered Indian tax platform, **grounded only in primary law +
uploaded documents** — every answer is citation-backed or it refuses. Three
surfaces today:

- **Ask Bot** — research the corpus (statutes / rules / circulars), cited.
- **Documents** — upload a notice/order, ask questions scoped to that file.
- **Appeals** — draft CIT(A)/NFAC appellate orders, grounded on statutes + case
  law, exported to DOCX. (This is the consolidation of the old `appeal` tool.)
- **Rulings** — case-law search over the judgment corpus.

> The README still lists case-law / Draft Bot as "out of MVP scope" — that is
> now **stale**; both shipped in the consolidation. Treat this file as current.

## 2. Run it locally (5 minutes)

```bash
cp .env.example .env       # then edit secrets/model names (see §3)
make up                    # build + start core stack (postgres, redis, minio, ml-server, api, worker, beat, frontend)
make migrate               # apply DB migrations (Alembic)
make seed                  # admin user + demo wings/seats
```

- Frontend: http://localhost:5173  ·  API docs: http://localhost:8000/docs
- Demo logins: `admin/admin123` (super_admin), `wingadmin/wing123`,
  `officer1/officer123`, `officer2/officer123`, `auditor1/auditor123`.

Backend code is volume-mounted — after editing Python, `docker compose restart
api worker`. New frontend deps need
`docker compose up -d --build --renew-anon-volumes frontend`.

## 3. Things NOT in git (must be obtained separately)

These are `.gitignore`d on purpose — Nitin will hand them over out-of-band:

| Item | Why it's excluded | What to do |
|---|---|---|
| `.env` | secrets (LLM key, DB/MinIO creds) | copy `.env.example` → `.env`, fill in |
| `data/manual/**` | large/external source PDFs (statutes, judgments) | get the corpus drop; place per `config/sources.yaml` |
| `handover/` DB dump | large; ship separately | `make migrate && make seed` for a fresh DB, **or** restore the dump |

### LLM backend (the one switch that matters)
`LLMClient` is behind one `.env` var — **no code change** dev↔prod:

- `LLM_BACKEND=mock` — boots with no model; **passes prompts through unchanged**
  (Ask/Improve-prompt return safe placeholders). Use only to smoke-test wiring.
- `LLM_BACKEND=ollama` — local dev model. `ollama pull qwen2.5:3b-instruct`,
  `LLM_BASE_URL=http://host.docker.internal:11434/v1`. (Current dev setting.)
- `LLM_BACKEND=vllm` / `openai` — prod (Qwen2.5-14B) or any OpenAI-compatible
  endpoint (Gemini works via Google's OpenAI-compat URL). Rotate any shared key.

## 4. Populate the corpus

- **Primary law** (Workstream B): drop sources under `data/manual/` per
  `config/sources.yaml`, then `make ingest` and `make verify-corpus`.
- **Case law** (for Appeals + Rulings): drop judgment PDFs into
  `data/manual/case_law/` (+ optional `manifest.jsonl` for proper titles/URLs),
  then either click **Admin → Corpus → Ingest case law** (super_admin) or run
  `docker compose run --rm worker python -c "from app.ingestion.case_law import ingest_dir; ingest_dir('/data/manual/case_law')"`.
  Ingest is idempotent (checksum dedup, durable per-batch commits).
  **Full format + manifest spec: [`docs/case_law_corpus.md`](docs/case_law_corpus.md)**
  (a ready example sits at `data/manual/case_law/manifest.example.jsonl`).

Check state anytime: **Admin → Corpus** (chunks by domain) or
`GET /admin/corpus/stats`.

## 5. New since the last README (the consolidation)

- **Appeals**: `models/appeal.py`, `services/appeal_draft.py` (grounded draft,
  classify→ground→draft per issue→assemble), `services/appeal_export.py` (DOCX),
  `api/routes/appeal.py` (12 routes), Celery `run_appeal_case`. UI:
  `pages/Appeals.tsx`, `pages/AppealCase.tsx`.
- **Rulings**: `core/enums.py` `Domain.case_law` + `SourceType.judgment`,
  `ingestion/case_law.py`, `api/routes/rulings.py`, `pages/Rulings.tsx`. Enum
  values added via Alembic `21d8f0b67d33` (`autocommit_block`).
- **Admin corpus**: `/admin/corpus/stats` + `/admin/corpus/ingest-case-law`,
  Corpus card in `pages/Admin.tsx`.
- **Improve prompt**: `services/prompt_refine.py`, `api/routes/assist.py`
  (`POST /assist/improve-prompt`), `components/ImprovePrompt.tsx` — wired into
  Ask and Documents with one-click undo. Retrieval-free; must not invent facts.
- **UI uplift**: shadcn/ui foundation + sidebar app shell (`components/Layout.tsx`,
  `components/ui/*`, design tokens in `index.css`).

## 6. Open items (now owned by Anand)

- [ ] **Bulk case-law ingest** — pipeline ready; only ~5 judgments / 16 chunks
      loaded as proof. Needs the real judgment PDF corpus.
- [ ] **Tighten Improve-prompt guard** — the small 3B dev model sometimes
      over-specifies (injects a section number the user didn't write). Prod model
      adheres; add an explicit "never name a section the user didn't" guard if
      staying on small models. (`services/prompt_refine.py`)
- [ ] **Refresh README** — it lists case-law/Draft Bot as out-of-scope (stale).
- [ ] **Retire the old `appeal` repo** — superseded by this; archive once Anand
      confirms parity.
- [ ] **Production**: `docker-compose.gpu.yml` + `LLM_BACKEND=vllm`; rotate any
      shared LLM key before going live.

## 7. Tests

`make test` (runs in the api container against Postgres): chunker,
retrieval-grounding (anti-hallucination refusal + citations), licensing
(seat-pool concurrency).
