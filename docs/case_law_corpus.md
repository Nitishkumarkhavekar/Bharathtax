# Case-law corpus — how to add judgments

This is the corpus the **Appeals** drafter and **Rulings** search cite from
(`domain = case_law`). Source of truth for the format is
[`backend/app/ingestion/case_law.py`](../backend/app/ingestion/case_law.py).

## 1. Drop the PDFs

Put judgment PDFs anywhere under:

```
data/manual/case_law/            # ingest globs **/*.pdf  (nested folders are fine)
  ITXA_1109_2018.pdf
  hc/bombay/2019/some_case.pdf
  manifest.jsonl                 # optional, see §2 — must sit in this root dir
```

`data/manual/**` is gitignored (large/external), so these live on the box, not
in git.

## 2. `manifest.jsonl` (optional but recommended)

One JSON object **per line** (JSONL — no commas between lines, no comments).
It gives each judgment a proper case title and a source URL. Without it, the
title falls back to the filename (underscores → spaces) and there is no URL.

| Field | Required | Used for |
|---|---|---|
| `fname` | **yes** | Match key — the PDF's **filename only** (basename, with `.pdf`), even if the PDF is nested. Lines whose `fname` matches no file are ignored. |
| `title` | recommended | Case title shown in Rulings and in citations. Truncated to 300 chars. |
| `pdf_key` | optional | Builds `source_url` = `https://indian-high-court-judgments.s3.ap-south-1.amazonaws.com/<pdf_key>` (the AWS Open-Data HC-judgments bucket). Omit if your PDFs aren't from that bucket — currently that S3 base is the only URL form supported; for other sources leave it out (no URL) until the source list is extended. |
| anything else | no | Ignored today (e.g. `court_name`, `date`, `citation`) — safe to include for future use. |

### Example (`manifest.example.jsonl`)

```jsonl
{"fname": "ITXA_1109_2018.pdf", "title": "Devdatta Mandelia vs Income Tax Officer (ITAT Mumbai, 2019)", "court_name": "ITAT Mumbai", "date": "2019-03-14"}
{"fname": "some_case.pdf", "title": "CIT vs ABC Pvt Ltd (Bombay HC, 2020)", "pdf_key": "data/pdf/bombay/2020/some_case.pdf"}
{"fname": "sc_unexplained_credit.pdf", "title": "PCIT vs XYZ (Supreme Court, 2021)"}
```

Tips: keep titles in a consistent `Appellant vs Respondent (Court, Year)` shape
— that's what officers scan in Rulings.

## 3. Ingest

Either path is idempotent (SHA-256 dedup per source, durable per-batch commits),
so re-running only adds new files:

- **UI:** log in as `super_admin` → **Admin → Corpus → Ingest case law**.
- **CLI:**
  ```bash
  docker compose run --rm worker \
    python -c "from app.ingestion.case_law import ingest_dir; print(ingest_dir('/data/manual/case_law'))"
  ```
  Prints `{"files": N, "chunks": M}`.

Verify: **Admin → Corpus** (chunks by domain) or `GET /admin/corpus/stats`.
Then test in **Rulings** — your case titles should appear in search results.
