# Design — User Memory & Personalization

Goal: make the chat *feel* like ChatGPT/Claude (memory + personalization) while
keeping BharathTax's grounding, and work in **both** deployment modes — cloud SaaS
and the installable on-prem/air-gapped app (like the appeals desktop app). Memory
always lives in the deployment's own DB; the subscription is controlled centrally
by the BharathTax admin via the existing license-key/seat system. Personal context
is only ever fed to the **self-hosted** model — never the external web-search fallback.

## What already exists (don't duplicate)
`app/models/chat.py` already provides **per-conversation** memory:
- `ChatMemory` — semantic recall of turns *within one chat*.
- `ChatSummary` — rolling summary of a long chat.

These handle continuity *inside* a thread. They do **not** carry facts across chats,
and there's no user profile or custom-instructions layer. That's this feature.

## Three layers of memory
1. **Profile (stable)** — on `users`: `role`, `designation`, `wing`, and now
   `charge`, `preferred_language`. Drives standpoint, examples, and order/notice headers.
2. **Preferences (explicit)** — `user_settings`: `custom_instructions`, `about_me`,
   `style` (concise/tables/citation density/standpoint), `memory_enabled`.
3. **Learned global memory (dynamic)** — `user_memory`: durable facts carried across
   *every* conversation (the ChatGPT-style "memory"), complementing the per-chat
   `ChatMemory`. Kinds: `fact | matter | preference`. Every row is user-visible,
   editable, deletable, pinnable.

## Schema (this commit — step 1)
- `users` += `charge`, `preferred_language`
- `user_settings` (1 row/user)
- `user_memory` (many rows/user, `user_id` indexed)
- Alembic `f7b2c4d9e310` (idempotent; single head)

## Context Assembler (step 3 — the key runtime piece)
One service `get_context(user, query)` builds a compact personalization preamble:
1. Profile + custom instructions → always included.
2. **Relevant** `user_memory` only → top-N by pinned/recency/(later) similarity — don't dump all.
3. Injected into the chat system prompt (in `services/rag.py` → gateway system note),
   and used by the drafting suite to fill headers/standpoint.

## Write path
- **Explicit:** "remember that…" + the Settings page.
- **Automatic:** post-conversation extraction proposes salient facts → stored with a
  visible "Memory updated" cue; source = `auto:chat:<id>`; user can undo.
- Gated by `user_settings.memory_enabled`.

## Governance (a procurement asset, not just a feature)
Per-user isolation · fully user-visible/deletable · audited · never sent externally.
Maps onto the trust/audit pillar and the SC white-paper posture.

## Build order
1. **Schema + models + migration** ✅ (this commit)
2. Memory service — `get_context()` + CRUD for settings & memory
3. Wire into chat (system-note injection); verify personal data stays local-model-only
4. Settings page — Profile · Custom instructions · Memory manager
5. Auto-extraction + "Memory updated" cue
6. Feed drafting — profile → order/notice headers & standpoint
