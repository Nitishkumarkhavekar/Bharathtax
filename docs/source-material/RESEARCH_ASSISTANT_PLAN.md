# Plan — Tax Research Assistant ("Ask" chatbot) + Rulings Explorer

> What officers get from **Taxsutra** / **Taxmann.AI** today, rebuilt **in-house** on our own
> retrieval-only corpus (statutes + free/official case law), with verifiable citations and no
> subscription dependency. Complements the appeal-drafting app (a separate "Research" area).

## 1. What Taxsutra / Taxmann.AI do (and how officers use them)
- **Taxsutra (`taxsutra.com`, `database.taxsutra.com`)** — subscription tax-research platform:
  - **117,000+ income-tax rulings** (SC / HC / ITAT / AAR / foreign), reported + handpicked unreported.
  - **Advanced search** — filters by court level, location, case number, citation, **section**; boolean
    ("Bulls Eye": exact / any / none); highlight-within-content.
  - **Expert analysis & compendiums** (e.g. "Recent rulings on unexplained credits u/s 68") + realtime news.
  - **Transfer-Pricing database** (7,300+ cases), APA/BEPS trackers.
  - *Officers use it to:* find case law by section/issue, read curated analysis, track recent rulings to
    support/justify their orders.
- **Taxmann.AI (screenshot)** — an **"Ask" chatbot**: natural-language tax question → a structured,
  source-backed answer ("Understanding of query → Executive Summary → analysis", with module/style
  selectors, a query quota counter, prompt-improve, chat history).

**Why we can't integrate them directly** (established earlier): both are **paywalled, no public API, ToS
forbids scraping**. So we **replicate the function**, not their content — on the corpus we already own.

## 2. Our approach — two features that cover the daily value
| Their feature | Our in-house equivalent | Built on |
|---|---|---|
| Taxmann.AI "Ask" bot | **Research Assistant ("Ask")** — conversational, cited Q&A | `rag.query` + LLM adapter (have both) |
| Taxsutra rulings search | **Rulings Explorer** — filtered search/browse of our judgments | case-law layer + metadata |
| Expert analysis/compendium | LLM-generated, **retrieval-grounded** analysis in the Ask answer | same |
| Realtime news / TP DB | *Out of scope for v1* (could add a feed later) | — |

Taxmann/Taxsutra **remain a manual premium reference** for officers who hold logins; our tool gives a free,
cited, always-available baseline for the common needs.

## 3. Feature A — Research Assistant ("Ask") chatbot
A Taxmann.AI-style chat, but **retrieval-only** (cites only our stored statutes/judgments; no hallucinated law).

**UX (officer "Research" area):**
- Chat with **conversation history** (left rail), like the screenshot.
- Each answer: a short **"Understanding"**, the **answer**, and a **Sources** list — every citation links to the
  **source PDF at the page** (reuses our viewer). Ungrounded claims are suppressed.
- Controls: **scope** (statutes / case-law / both), **style** (concise / explanatory), optional **section/court
  filter**, and a **"used in a case?"** link to drop a finding into an appeal draft.
- **Streaming** answers (token-by-token) via SSE/WebSocket.
- Per-user **query quota** + usage (we already meter tokens) → mirrors the "Queries 9/10" counter.

**Architecture (reuses what exists):**
- Retrieval: `rag.query.retrieve()` over the corpus (pgvector), layer/filter aware.
- Generation: `appeal_tool.llm` (Gemini/Claude/local), with a research prompt + the anti-hallucination rule.
- Persistence: new `Conversation` + `Message` tables (per user/org); store the cited sources per message.
- Endpoints: `POST /api/v1/research/ask` (stream), `GET/POST /api/v1/research/conversations`,
  `GET /conversations/{id}`. Reuses RBAC (officer area) + usage metering + audit.

**Data model:** `Conversation(id, user_id, org_id, title, created_at)` ·
`Message(id, conversation_id, role, content, sources_json, created_at)`.

**Anti-hallucination:** identical guardrail to drafting — the model is given retrieved chunks tagged
`[source: file p.N]` and may cite only those; a post-check flags any ungrounded citation.

## 4. Feature B — Rulings Explorer (Taxsutra-style search)
- Full-text + semantic **search over the case-law layer** with **filters**: court, year, section, keyword.
- Results list → open the **judgment PDF** (source viewer) + "Ask about this ruling" (hands it to the chatbot).
- Backed by the case-law metadata (`hc_manifest.jsonl` + pgvector) we already ingest; grows via the
  acquisition console.
- Gives officers the "search the rulings DB" muscle of Taxsutra, on free/official judgments.

## 5. How it fits the product
- New **"Research"** section in the **officer app** (alongside "My Cases"): tabs **Ask** + **Rulings**.
- **Admin** already governs the corpus that powers it (upload, acquisition, reindex) and sees usage.
- Strictly separated from the platform console (officers only), per the access model just set.

## 6. Build plan — proposed Epic E6 "Research Assistant"
1. **E6a** Ask chatbot MVP: conversations/messages tables + `POST /research/ask` (retrieval → cited answer) +
   officer "Research → Ask" UI with sources. (Non-streaming first.)
2. **E6b** Streaming answers (SSE/WebSocket) + chat history rail + scope/style controls + per-user quota.
3. **E6c** Rulings Explorer: case-law search API (filters) + UI + source viewer + "Ask about this ruling".
4. **E6d** "Insert into draft" bridge (use a research finding inside an appeal), and a recent-rulings list.

Each phase is independently shippable and reuses the existing retrieval + LLM + RBAC + usage + audit.
