# IT-Appeal Tool — project instructions

**Read [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) first** — it is the single source of truth for this
project (what the tool is, the 6 modules, data sources, the data-sourcing strategy, and open questions).

## What this is
An AI assistant that drafts **appellate orders** for the **CIT(A) / NFAC** under the Income-tax Act —
automating the officer's current manual Copilot workflow (see `Appeal Order tool.docx`).

## Source material in this folder
- `Appeal Order tool.docx` — the officer's working system prompt (the 6-module spec).
- `IT - BMTC - APPEAL.m4a` — requirements discussion recording (28:50).
- `transcript.txt` / `.srt` — raw local transcript; `Appeal_Discussion_Transcript.md` — cleaned English version.
- 3 × WhatsApp `.jpeg` — the officer's handwritten requirement notes.
- `transcribe.py` — local faster-whisper transcription script.

## Conventions
- Keep `PROJECT_CONTEXT.md` updated as the source of truth when decisions change.
- Case-law sourcing: **free official sources + Indian Kanoon API** as the backbone; **official
  Taxmann/Taxsutra licences** as an optional premium layer — **never scrape** (see the strategy section).
- Anti-hallucination is non-negotiable: **retrieval-only** citations linked to stored source documents.
