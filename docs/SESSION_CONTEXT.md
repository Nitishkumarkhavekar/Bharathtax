# Working context — consolidation + handover (as of 2026-06-26)

Snapshot of recent work so a new Claude Code session (run in
`C:\Users\HP\Projects\taxmedha`) can pick up cleanly. Companion to
[`HANDOVER.md`](../HANDOVER.md) (run guide) and [`README.md`](../README.md).

## Where things stand
The old `IT-Appeal` tool (formerly `C:\Users\HP\Projects\appeal`) was
**consolidated into this BharatTax repo and retired**. Work happens **only
here** now. Repo: https://github.com/Nitinkaroshi/bharathtax (private), owner
Nitin, **Anand @anandkaman invited as admin** (pending acceptance).

## What shipped recently (all pushed to `master`)
- **Appeals** module — CIT(A)/NFAC order drafting, grounded on statutes + case
  law (bge-m3), DOCX export. `backend/app/{models/appeal.py,services/appeal_draft.py,
  services/appeal_export.py,api/routes/appeal.py}`, UI `frontend/src/pages/Appeals*.tsx`.
- **Rulings** — case-law search. `Domain.case_law`, `ingestion/case_law.py`,
  `api/routes/rulings.py`, `pages/Rulings.tsx`.
- **Improve prompt** — refines a rough query into a precise one, retrieval-free,
  with a deterministic anti-invention guard (strips any section/year/placeholder
  the user didn't write; keeps user-typed refs like `u/s 68`, `44AD`, `271(1)(c)`,
  `AY 2021-22`). `backend/app/services/prompt_refine.py`, `api/routes/assist.py`,
  `frontend/src/components/ImprovePrompt.tsx`. Wired into Ask + Documents.
- **Admin → Corpus** — stats by domain + super-admin "Ingest case law" button.
- **UI uplift** — shadcn/ui foundation + sidebar app shell.
- **Source material** preserved in `docs/source-material/` (officer spec docx,
  28-min requirements recording + transcripts, transcription script, 3 photos).
- Docs: `HANDOVER.md`, `docs/case_law_corpus.md`, `docs/source-material/README.md`,
  refreshed `README.md`.

## Corpus state
`income_tax`: 3,898 chunks · `case_law`: 1,113 chunks across **221 judgments**.
The 289 Bombay HC income-tax judgments from the old repo were ingested
(`data/manual/case_law/` + `manifest.jsonl`, gitignored). **68 PDFs yielded no
chunks** — image-only scans; the pipeline has no OCR (see open items).

## Environment / gotchas
- **LLM backend = `ollama`** (`qwen2.5:3b-instruct` on host:11434), set in `.env`.
  `mock` passes prompts through unchanged. Prod = `vllm`/`openai` (Qwen-14B/Gemini).
- Backend is volume-mounted: after editing Python, `docker compose restart api worker`.
  New frontend deps: `docker compose up -d --build --renew-anon-volumes frontend`.
- DB user is `taxmedha`. Demo logins seeded (`admin/admin123`, `officer1/officer123`, …).
- Seat pool: stale dev leases block logins; release with
  `update seat_leases set released_at=now() where released_at is null;` or wait for the reaper.
- `.env`, `data/manual/**`, `handover/` are gitignored (ship separately).

## Open items (next work)
1. **OCR fallback** for the 68 image-only judgments (e.g. `ocrmypdf`/Tesseract in
   `ingestion/extract/pdf.py` when text extraction is empty).
2. **Production**: `docker-compose.gpu.yml` + `LLM_BACKEND=vllm`; rotate any shared key.
3. **Refresh** `docs/source-material/PROJECT_CONTEXT.md` references (pre-consolidation).
4. Final cleanup: delete the empty `C:\Users\HP\Projects\appeal` folder (a locked
   `Appeal Order tool.docx` + `RETIRED.md` remain; backup at
   `C:\Users\HP\Projects\appeal_RETIRED_2026-06-26.zip`, 553 MB).

## How to continue this conversation in the BharatTax repo
Open Claude Code in `C:\Users\HP\Projects\taxmedha` and run `/resume` (or
`claude --resume`) — this session's transcript was copied into taxmedha's session
store, so it appears in the list. If it's not there, this file is the fallback.
