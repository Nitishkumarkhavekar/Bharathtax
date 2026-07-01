# BharathTax — GPU Embedding Handoff (the `embed-pending` pass)

**Goal:** turn the already-staged CBDT corpus (chunks in Postgres with `embedding = NULL`)
into a fully vector-searchable corpus by running **one batch job on the 16 GB GPU box**.
No re-crawling, no re-parsing — the CPU work is already done. This is pure embedding.

Copy everything under **"PROMPT TO RUN ON THE GPU BOX"** into a Claude Code session
(or hand to whoever owns the box). It is self-contained.

---

## Background (what's already true)

- All CBDT documents are downloaded and **staged**: parsed → structure-aware chunked →
  written to `corpus_chunks` with `embedding = NULL` and the parent `corpus_documents`
  row left at `status = 'parsed'`.
- Volume to embed (measured 2026-07-01 after staging): **34,572 chunks** pending across
  **12,462 documents** (53,601 chunks total; 19,029 already embedded from earlier runs).
  Breakdown of pending: notifications 31,937 · circulars 2,635. Re-confirm live with the
  count query below (it only grows if more sources are staged).
- **197 notification PDFs are image-only (scanned)** — they were staged with empty text
  (OCR was skipped for speed). They need an OCR pass; see the OCR step below.
- The embedding model is **BAAI/bge-m3** (1024-dim, cosine), served by the `ml-server`
  container. On a 16 GB GPU (fp16) this is fast — expect **~10–30 min** of compute for
  the whole corpus, not hours.
- The command is **idempotent and resumable**: it only touches `embedding IS NULL` rows,
  commits per batch, and promotes a document to `status = 'indexed'` once all its chunks
  are embedded. Safe to Ctrl-C and re-run.

## Two ways to run it — pick ONE

**Path A — Offload compute only (data stays on the current box).** Simplest if the
Postgres holding the staged chunks is reachable from the GPU box (or vice-versa).
Bring up a GPU `ml-server` on the box, point the app's `ML_SERVER_URL` at it, run
`embed-pending` from wherever the app + DB live.

**Path B — Move the corpus to the GPU box (recommended for "embed at scale").**
`pg_dump` the corpus, restore it on the GPU box, run the whole stack there with a GPU
`ml-server`, run `embed-pending` locally. Fully self-contained; no cross-host DB traffic.

---

## PROMPT TO RUN ON THE GPU BOX

> You are operating the BharathTax repo on a Linux host with an NVIDIA 16 GB GPU and the
> NVIDIA Container Toolkit installed. The income-tax corpus has already been crawled,
> parsed and chunked on another machine; every chunk is in Postgres with a NULL
> embedding. Your ONLY job is to embed those chunks on the GPU and verify the result.
> Do not re-crawl or re-parse anything. Work carefully, confirm each step's output before
> moving on, and stop and report if a check fails.
>
> **1. Bring up the GPU embedding server** (bge-m3 + reranker on CUDA, fp16):
> ```bash
> docker compose -f docker-compose.ml.yml up -d --build
> # first boot downloads ~4.6 GB of weights into the hfcache volume; wait for healthy:
> curl -fsS http://127.0.0.1:8001/health && echo OK
> ```
>
> **2. Make sure the app/worker points at this GPU ml-server and the corpus DB.**
> In the repo `.env` (or the app container's environment):
> ```
> ML_SERVER_URL=http://ml-server:8001        # same-host compose network, or http://<GPU_IP>:8001 if remote
> DATABASE_URL=...                            # must point at the Postgres holding the STAGED chunks
> ```
> If the staged corpus lives on another host, either restore a dump here first
> (Path B — `pg_dump`/`pg_restore` the `corpus_*` tables) or set `DATABASE_URL` to the
> remote Postgres (Path A).
>
> **3. Confirm there is work to do** — count NULL-embedding chunks:
> ```bash
> docker compose exec api python -c "
> from app.core.db import SessionLocal; from sqlalchemy import text
> db=SessionLocal()
> print('pending (NULL embedding):', db.scalar(text('SELECT count(*) FROM corpus_chunks WHERE embedding IS NULL')))
> print('by source:', db.execute(text('''SELECT s.key, count(*) FILTER (WHERE c.embedding IS NULL) pending
>   FROM corpus_chunks c JOIN corpus_sources s ON s.id=c.source_id GROUP BY s.key ORDER BY 1''')).all())
> db.close()"
> ```
> Expect tens of thousands pending. If it's 0, the corpus is already embedded — skip to step 5.
>
> **4. Run the embedding pass** (idempotent, resumable, commits per batch):
> ```bash
> docker compose exec api python -m app.ingestion.pipeline embed-pending --batch 256
> ```
> Watch the `embedded N/total` progress. On a 16 GB GPU this should finish in ~10–30 min.
> If it dies, just run the same command again — it resumes from the first NULL row.
>
> **4b. (Optional but recommended) OCR the 197 image-only scanned notifications.**
> These were staged with empty text (OCR was skipped during bulk CPU staging). They have
> 0 chunks, so re-running staging **with OCR enabled** re-processes exactly those (every
> doc that already has chunks is skipped). The box has more cores than the dev laptop, so
> OCR won't stall it — but keep it to ONE process (OCR is CPU-heavy):
> ```bash
> # OCR ON = simply do NOT set ITD_SKIP_OCR
> docker compose exec api python -m app.ingestion.pipeline run --no-embed --source cbdt_notifications_recent
> ```
> This fills text + chunks for the scanned docs (leaving NULL embeddings), which the next
> `embed-pending` run then vectorizes. If you skip this, those 197 docs stay non-searchable
> but nothing else is affected.
>
> **5. Verify the corpus is fully indexed:**
> ```bash
> docker compose exec api python -m app.ingestion.pipeline verify
> ```
> All checks must read **PASS** — especially `all chunks embedded`, `all chunks have tsv`,
> `HNSW index present`, `GIN index present`. Report the printed counts (chunks, embedded,
> by-domain).
>
> **6. Smoke-test retrieval** — confirm a real query returns cited CBDT material:
> ```bash
> docker compose exec api python -c "
> from app.services import embeddings as emb
> print('embed dim:', len(emb.embed_one('test'))) "   # expect 1024
> ```
> Then, in the running app, ask a question that should hit a circular/notification (e.g.
> a TDS/threshold circular) and confirm the answer is grounded with a citation.
>
> Report back: pending-before, embedded count, `verify` PASS/FAIL lines, and total time.

---

## Notes / gotchas

- **GPU memory:** bge-m3 fp16 needs ~4–5 GB. If vLLM (the answer LLM) is also on the box,
  cap each with `--gpu-memory-utilization` (see `docker-compose.llm.yml`) so they coexist
  on 16 GB. For the embed pass alone you don't need the LLM up.
- **Do NOT run the embed pass as many parallel processes inside one container** — that's
  what OOM-killed the CPU staging run. `embed-pending` is single-process by design; the
  GPU is the throughput, not process count. Raise `--batch` (e.g. 512) if you want more
  GPU utilization.
- **`ML_DEVICE=cuda`** is already set in `docker-compose.ml.yml`. Confirm the container
  actually sees the GPU: `docker compose exec ml-server python -c "import torch; print(torch.cuda.is_available())"` → `True`.
- **Security:** `ml-server` has no auth. Never expose `8001` to the public internet —
  firewall it to the app host or bind it to a private/VPN interface.
- After this pass, wire **Phase 5 freshness** (Celery-beat delta crawl + re-embed) so new
  circulars/notifications flow in automatically.
