# Codebase audit — status & follow-ups

Branch `fix/audit-hardening` fixes the P0/P1 items that are safe to do without
in-app testing or cross-team coordination. This file tracks the rest.

## ✅ Done on `fix/audit-hardening`
- **Repo hygiene**: untrack `.secrets/`, `desktop/.ebcache/` (~445 build binaries),
  `data/corpus_dataset/*`, the 28 MB `.m4a`; gitignore them.
- **Bugs**: fixed the `case` NameError that broke OnlyOffice force-save / preview
  flush; content-addressed upload keys (no filename collision / `../` traversal)
  + delete guard; `edit_output` null-guard.
- **Security**: OnlyOffice token owner re-check; CORS from config; prod fail-fast
  on `change-me` secrets / wildcard CORS; per-IP rate limit on `/auth`.
- **RAG correctness/perf**: honest `grounded` flag; `retrieve_documents` reranker
  fallback; batched retrieval lookups (was N+1); reranker payload cap; section
  cap 300→600 (new Act).
- **Alembic**: resolved the double-head (re-parented the stray migration).
- **CI**: added `.github/workflows/ci.yml` (bug-lint, alembic single-head,
  secret guard, builds).
- **Privacy**: chat source chips no longer fetch favicons from Google.

## 🔶 Needs a team decision / owner (NOT done here)
1. **Gateway generation defaults to Gemini** (`scripts/rag_core.py:414`). Every
   chat answer + retrieved corpus passages leave the box. This deploys to the
   **GPU box** and was a deliberate call by the model owner. Decision: set
   `CHAT_LLM=local` (env) to make the self-hosted model primary again, and fail
   *closed* (refuse) on retrieval failure instead of silently answering
   ungrounded via Gemini flagged `grounded=True`. → owner of the ai-model track.
2. **Gateway robustness** (`scripts/rag_core.py`): tag the hardcoded tax slabs
   with an assessment year (silent staleness); gate the officer-standpoint prompt
   by caller role (a taxpayer on the public widget gets departmental-action
   advice); require a reviewer credential before the `/v1/feedback` store injects
   "authoritative" answers (poisoning); monitor Gemini reachability in the
   watchdog (it watches vLLM, which is no longer on the chat path).
3. **Desktop ↔ web divergence**: `desktop/` reimplements the whole appeals flow
   with its own API client and a Word-based editor (web uses OnlyOffice); the
   "fixed draft appeal order" work exists only on desktop. Extract a shared
   package (appeal API client + `ModifyWithAI` + version/undo) so fixes land
   once. Architectural — needs planning + testing on both apps.
4. **Git history scrub** of the old (rotated) Gemini key with BFG/`git filter-repo`
   + a coordinated force-push (others have clones). Key is already rotated, so
   this is cleanup, not urgent.

## 🔷 Mechanical — best done with the app running
5. Route the ~27 `alert()` / empty-catch sites across the admin pages through the
   existing `toast` system; surface chat persist/delete failures; add `aria-label`s
   to the chat `<select>`s and feedback buttons; split the 1,766-line
   `AppealCase.tsx`.
6. Backfill tests: `/auth` (login/JWT/registration), entitlements
   (403-on-missing-feature), admin routes, appeal-draft generation — none are
   covered today.
