# Source material — IT-Appeal tool (original requirements & research)

Preserved from the original `appeal` project (now retired; superseded by this
BharatTax repo). This is the **foundational context** for the Appeals module —
what the officer asked for and why. Kept here so it travels with the project.

## Requirements & specification
- **`Appeal Order tool.docx`** — the officer's working system prompt: the 6-module
  spec the Appeals drafter automates. The primary requirements artifact.
- **`REQUIREMENTS.md`** — distilled requirements.
- **`PROJECT_CONTEXT.md`** — the original single-source-of-truth (modules, data
  sources, sourcing strategy, open questions). Predates consolidation; read
  alongside this repo's `README.md` / `HANDOVER.md`.
- **`ARCHITECTURE.md`**, **`RESEARCH_ASSISTANT_PLAN.md`** — early design notes.
- **`appeal-README.md`**, **`appeal-CLAUDE.md`** — the retired repo's own README
  and project instructions, for reference.

## Requirements discussion (28:50 recording)
- **`IT - BMTC - APPEAL.m4a`** — the raw requirements call with the officer.
- **`Appeal_Discussion_Transcript.md`** — cleaned English transcript (read this).
- **`transcript.txt`**, **`transcript.srt`** — raw local transcripts.
- **`transcribe.py`**, **`transcribe_log.txt`** — the faster-whisper script used
  to produce the transcripts.

## Handwritten notes
- **`WhatsApp Image 2026-06-24 at 5.14.53 PM*.jpeg`** (×3) — the officer's
  handwritten requirement notes.

> Not preserved here: the old app's source code and the bulk corpus PDFs. The
> 289 Bombay HC income-tax judgments from the old corpus were **ingested into
> the BharatTax case-law corpus** (domain `case_law`) — see
> [`docs/case_law_corpus.md`](../case_law_corpus.md). The large statute PDFs
> (IT Act/Rules) were dropped — this repo maintains its own primary-law corpus.
